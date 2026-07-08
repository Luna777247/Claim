// Initialize theme immediately to prevent flashing
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const themeParam = urlParams.get('theme');
  const savedTheme = themeParam || localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
  }
})();

// Global variables
let ontologyData = null;
let elk = null;
let currentSelection = null;
let currentTab = 'properties';

// Zoom and Pan state
let zoom = 1;
let translateX = 50;
let translateY = 50;
let isDragging = false;
let startX, startY;
const svg = document.getElementById('graph-svg');
const viewport = document.getElementById('viewport-group');

// Layout cache
let absoluteNodeCoords = {}; // object_id -> { x, y, width, height, domainId }
let domainPositions = {}; // domainId -> { x, y, width, height }

// Filter / Toggle state
let showDatatypes = true;
let showCrossDomain = true;
let activeDomainFilter = null;

// Initialize ELK
if (typeof ELK !== 'undefined') {
  elk = new ELK();
} else {
  console.error("ELK library not loaded properly!");
}

// Fetch ontology data
if (window.ONTOLOGY_DATA) {
  ontologyData = window.ONTOLOGY_DATA;
  initializeDashboard();
} else {
  fetch('ontology.json')
    .then(response => response.json())
    .then(data => {
      ontologyData = data;
      initializeDashboard();
    })
    .catch(error => console.error("Error loading ontology data:", error));
}

function initializeDashboard() {
  populateLegend();
  setupEventListeners();
  renderGraph();
}

// Populate Legend Panel
function populateLegend() {
  const legendList = document.getElementById('legend-list');
  legendList.innerHTML = '';
  
  ontologyData.domains.forEach(domain => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.dataset.domainId = domain.id;
    item.innerHTML = `
      <div class="legend-color" style="background-color: ${domain.color}"></div>
      <div class="legend-text" title="${domain.id} - ${domain.vietnamese_name}">${domain.id} - ${domain.vietnamese_name}</div>
    `;
    item.addEventListener('click', () => filterByDomain(domain.id));
    legendList.appendChild(item);
  });
}

// Domain Filtering / Highlight
function filterByDomain(domainId) {
  const clearBtn = document.getElementById('btn-clear-domain-filter');
  
  if (activeDomainFilter === domainId) {
    // Toggle off
    activeDomainFilter = null;
    clearBtn.classList.add('hidden');
    document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('inactive'));
    resetHighlight();
  } else {
    activeDomainFilter = domainId;
    clearBtn.classList.remove('hidden');
    
    // Update legend UI
    document.querySelectorAll('.legend-item').forEach(i => {
      if (i.dataset.domainId === domainId) {
        i.classList.remove('inactive');
      } else {
        i.classList.add('inactive');
      }
    });
    
    // Highlight nodes and edges in SVG
    highlightDomain(domainId);
  }
}

function highlightDomain(domainId) {
  // Dim everything first
  document.querySelectorAll('.node-group').forEach(el => el.classList.add('dimmed'));
  document.querySelectorAll('.domain-group').forEach(el => el.classList.add('dimmed'));
  document.querySelectorAll('.edge-path').forEach(el => el.classList.add('dimmed'));
  document.querySelectorAll('.edge-label-group').forEach(el => el.classList.add('dimmed'));
  
  // Highlight targeted domain container
  const domainEl = document.getElementById(`domain-${domainId}`);
  if (domainEl) domainEl.classList.remove('dimmed');
  
  // Highlight nodes in this domain
  document.querySelectorAll(`.node-group[data-domain-id="${domainId}"]`).forEach(el => {
    el.classList.remove('dimmed');
  });
  
  // Highlight local edges in this domain
  document.querySelectorAll(`.edge-path[data-domain-id="${domainId}"]`).forEach(el => {
    el.classList.remove('dimmed');
  });
  document.querySelectorAll(`.edge-label-group[data-domain-id="${domainId}"]`).forEach(el => {
    el.classList.remove('dimmed');
  });
  
  // Zoom to domain bounding box
  const pos = domainPositions[domainId];
  if (pos) {
    zoomToRect(pos.x, pos.y, pos.width, pos.height);
  }
}

function resetHighlight() {
  document.querySelectorAll('.node-group').forEach(el => {
    el.classList.remove('dimmed');
    el.classList.remove('highlighted-node');
  });
  document.querySelectorAll('.domain-group').forEach(el => el.classList.remove('dimmed'));
  document.querySelectorAll('.edge-path').forEach(el => {
    el.classList.remove('dimmed');
    el.classList.remove('highlighted');
  });
  document.querySelectorAll('.edge-label-group').forEach(el => el.classList.remove('dimmed'));
}

// Zoom to bounding box
function zoomToRect(rx, ry, rw, rh) {
  const container = document.getElementById('canvas-container');
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  
  // Calculate scale to fit with margin
  const margin = 100;
  const scaleX = cw / (rw + margin);
  const scaleY = ch / (rh + margin);
  zoom = Math.min(scaleX, scaleY, 1.5); // cap zoom level at 1.5x
  zoom = Math.max(zoom, 0.05); // floor at 0.05x
  
  // Calculate translation to center the rectangle
  translateX = (cw - rw * zoom) / 2 - rx * zoom;
  translateY = (ch - rh * zoom) / 2 - ry * zoom;
  
  updateTransform();
}

// Reset view to fit all domains
function resetView() {
  // Find bounding box of all domains
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  Object.values(domainPositions).forEach(pos => {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  });
  
  if (minX === Infinity) {
    zoom = 0.5;
    translateX = 100;
    translateY = 100;
    updateTransform();
  } else {
    zoomToRect(minX, minY, maxX - minX, maxY - minY);
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Zoom & Pan Mouse Events
  svg.addEventListener('mousedown', (e) => {
    // Only drag on left mouse button and not on interactive groups
    if (e.button !== 0) return;
    if (e.target.closest('.node-group') || e.target.closest('.legend-panel') || e.target.closest('.zoom-controls')) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    svg.style.cursor = 'grabbing';
  });
  
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    updateTransform();
  });
  
  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      svg.style.cursor = 'grab';
    }
  });
  
  // Mouse Wheel Zoom
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.05;
    const mouseX = e.clientX - svg.getBoundingClientRect().left;
    const mouseY = e.clientY - svg.getBoundingClientRect().top;
    
    // Zoom centering calculations
    const wheel = e.deltaY < 0 ? 1 : -1;
    const zoomFactor = Math.exp(wheel * zoomIntensity);
    
    const nextZoom = Math.min(Math.max(zoom * zoomFactor, 0.03), 3);
    
    translateX = mouseX - (mouseX - translateX) * (nextZoom / zoom);
    translateY = mouseY - (mouseY - translateY) * (nextZoom / zoom);
    zoom = nextZoom;
    
    updateTransform();
  });

  // Zoom controls
  document.getElementById('zoom-in').addEventListener('click', () => {
    zoomPosition(1.2);
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    zoomPosition(0.8);
  });
  document.getElementById('zoom-fit').addEventListener('click', resetView);
  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  
  // Toggles
  document.getElementById('toggle-datatypes').addEventListener('change', (e) => {
    showDatatypes = e.target.checked;
    document.querySelectorAll('.node-property-type').forEach(el => {
      el.style.display = showDatatypes ? 'block' : 'none';
    });
  });
  
  document.getElementById('toggle-cross-domain').addEventListener('change', (e) => {
    showCrossDomain = e.target.checked;
    document.querySelectorAll('.edge-path.cross-domain').forEach(el => {
      el.style.display = showCrossDomain ? 'block' : 'none';
    });
    document.querySelectorAll('.edge-label-group.cross-domain').forEach(el => {
      el.style.display = showCrossDomain ? 'block' : 'none';
    });
  });
  
  // Domain filter clear button
  document.getElementById('btn-clear-domain-filter').addEventListener('click', () => {
    activeDomainFilter = null;
    document.getElementById('btn-clear-domain-filter').classList.add('hidden');
    document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('inactive'));
    resetHighlight();
  });

  // Search input
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear-btn');
  
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    if (val) {
      searchClear.classList.remove('hidden');
      searchOntology(val);
    } else {
      searchClear.classList.add('hidden');
      resetHighlight();
    }
  });
  
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hidden');
    resetHighlight();
  });

  // Theme toggle listener
  const themeBtn = document.getElementById('btn-toggle-theme');
  if (themeBtn) {
    if (document.body.classList.contains('light-theme')) {
      themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i> Giao diện';
    } else {
      themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i> Giao diện';
    }
    
    themeBtn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-theme');
      if (isLight) {
        localStorage.setItem('theme', 'light');
        themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i> Giao diện';
      } else {
        localStorage.setItem('theme', 'dark');
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i> Giao diện';
      }
    });
  }

  // Export buttons
  document.getElementById('btn-export-svg').addEventListener('click', exportToSVG);
  document.getElementById('btn-export-png').addEventListener('click', exportToPNG);
  document.getElementById('btn-export-pdf').addEventListener('click', exportToPDF);
}

function zoomPosition(factor) {
  const container = document.getElementById('canvas-container');
  const mouseX = container.clientWidth / 2;
  const mouseY = container.clientHeight / 2;
  const nextZoom = Math.min(Math.max(zoom * factor, 0.03), 3);
  translateX = mouseX - (mouseX - translateX) * (nextZoom / zoom);
  translateY = mouseY - (mouseY - translateY) * (nextZoom / zoom);
  zoom = nextZoom;
  updateTransform();
}

function updateTransform() {
  viewport.setAttribute('transform', `translate(${translateX}, ${translateY}) scale(${zoom})`);
}

// Search & highlight
function searchOntology(query) {
  // Find objects matching query or containing property matching query
  const matchingObjectIds = new Set();
  
  ontologyData.objects.forEach(obj => {
    if (obj.name.toLowerCase().includes(query) || obj.vietnamese_name.toLowerCase().includes(query)) {
      matchingObjectIds.add(obj.id);
    }
    obj.properties.forEach(p => {
      if (p.name.toLowerCase().includes(query) || p.vietnamese_name.toLowerCase().includes(query)) {
        matchingObjectIds.add(obj.id);
      }
    });
  });
  
  // If exact matching, select the first match
  if (matchingObjectIds.size > 0) {
    // Dim all
    document.querySelectorAll('.node-group').forEach(el => el.classList.add('dimmed'));
    document.querySelectorAll('.domain-group').forEach(el => el.classList.add('dimmed'));
    document.querySelectorAll('.edge-path').forEach(el => el.classList.add('dimmed'));
    document.querySelectorAll('.edge-label-group').forEach(el => el.classList.add('dimmed'));
    
    // Highlight matched
    matchingObjectIds.forEach(id => {
      const nodeEl = document.getElementById(`node-${id}`);
      if (nodeEl) nodeEl.classList.remove('dimmed');
      
      const obj = ontologyData.objects.find(o => o.id === id);
      if (obj) {
        const domEl = document.getElementById(`domain-${obj.domain_id}`);
        if (domEl) domEl.classList.remove('dimmed');
      }
    });
  } else {
    // Dim all if search yields nothing
    document.querySelectorAll('.node-group').forEach(el => el.classList.add('dimmed'));
    document.querySelectorAll('.domain-group').forEach(el => el.classList.add('dimmed'));
  }
}

// Run layout and rendering
async function renderGraph() {
  if (!ontologyData || !elk) return;
  
  const domainsGroup = document.getElementById('domains-group');
  const nodesGroup = document.getElementById('nodes-group');
  const edgesGroup = document.getElementById('edges-group');
  
  domainsGroup.innerHTML = '';
  nodesGroup.innerHTML = '';
  edgesGroup.innerHTML = '';
  
  // 1. Group objects by Domain
  const objectsByDomain = {};
  ontologyData.domains.forEach(d => {
    objectsByDomain[d.id] = [];
  });
  
  ontologyData.objects.forEach(obj => {
    if (objectsByDomain[obj.domain_id]) {
      objectsByDomain[obj.domain_id].push(obj);
    }
  });
  
  // 2. Identify intra-domain relationships
  const intraRelsByDomain = {};
  const crossDomainRels = [];
  
  ontologyData.domains.forEach(d => {
    intraRelsByDomain[d.id] = [];
  });
  
  ontologyData.relationships.forEach(rel => {
    const srcObj = ontologyData.objects.find(o => o.id === rel.source);
    const tgtObj = ontologyData.objects.find(o => o.id === rel.target);
    
    if (srcObj && tgtObj) {
      if (srcObj.domain_id === tgtObj.domain_id) {
        intraRelsByDomain[srcObj.domain_id].push(rel);
      } else {
        crossDomainRels.push(rel);
      }
    }
  });

  // 3. Layout each Domain individually
  const layoutPromises = ontologyData.domains.map(async (domain) => {
    const objects = objectsByDomain[domain.id] || [];
    if (objects.length === 0) return { domainId: domain.id, layout: null };
    
    const children = objects.map(obj => {
      // Calculate object card height
      // Header: 45px, Property rows: 22px each, Footer padding: 15px
      const height = 45 + obj.properties.length * 22 + 15;
      return {
        id: obj.id,
        width: 260,
        height: height
      };
    });
    
    const edges = (intraRelsByDomain[domain.id] || []).map((rel, idx) => ({
      id: `e_${domain.id}_${idx}`,
      sources: [rel.source],
      targets: [rel.target]
    }));
    
    const domainGraph = {
      id: domain.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '50',
        'elk.spacing.edgeNode': '35',
        'elk.layered.spacing.edgeEdge': '20',
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF'
      },
      children: children,
      edges: edges
    };
    
    try {
      const layout = await elk.layout(domainGraph);
      return { domainId: domain.id, layout: layout };
    } catch (err) {
      console.error(`ELK Layout error for domain ${domain.id}:`, err);
      return { domainId: domain.id, layout: null };
    }
  });
  
  const layoutResults = await Promise.all(layoutPromises);
  
  // Map layouts by domainId
  const layoutsByDomain = {};
  layoutResults.forEach(r => {
    if (r.layout) layoutsByDomain[r.domainId] = r.layout;
  });

  // 4. Arrange Domains in a balanced grid
  // Grid layout config: 3 columns
  const domainGrid = [
    ['D01', 'D02', 'D03'], // Row 0
    ['D04', 'D05', 'D06'], // Row 1
    ['D07', 'D08', 'D09'], // Row 2
    ['D10']                 // Row 3
  ];
  
  const colGap = 160;
  const rowGap = 200;
  const domainPaddingLeft = 40;
  const domainPaddingRight = 40;
  const domainPaddingTop = 75; // More space for domain header
  const domainPaddingBottom = 40;
  
  // Calculate width and height of each domain container
  const domainDimensions = {};
  ontologyData.domains.forEach(domain => {
    const layout = layoutsByDomain[domain.id];
    if (!layout) return;
    
    // size = ELK bounding box + padding
    const width = layout.width + domainPaddingLeft + domainPaddingRight;
    const height = layout.height + domainPaddingTop + domainPaddingBottom;
    
    domainDimensions[domain.id] = { width, height };
  });

  // Compute row heights and column widths
  const colWidths = [0, 0, 0];
  const rowHeights = [0, 0, 0, 0];
  
  domainGrid.forEach((row, r) => {
    row.forEach((domainId, c) => {
      const dim = domainDimensions[domainId];
      if (dim) {
        colWidths[c] = Math.max(colWidths[c], dim.width);
        rowHeights[r] = Math.max(rowHeights[r], dim.height);
      }
    });
  });
  
  // Position domains and objects
  domainPositions = {};
  absoluteNodeCoords = {};
  
  domainGrid.forEach((row, r) => {
    row.forEach((domainId, c) => {
      const domain = ontologyData.domains.find(d => d.id === domainId);
      const dim = domainDimensions[domainId];
      if (!domain || !dim) return;
      
      // Calculate domain position
      let x = 0;
      for (let i = 0; i < c; i++) x += colWidths[i] + colGap;
      
      let y = 0;
      for (let i = 0; i < r; i++) y += rowHeights[i] + rowGap;
      
      // For row 3 (D10 only), center it relative to columns
      if (r === 3 && row.length === 1) {
        const totalGridWidth = colWidths[0] + colWidths[1] + colWidths[2] + 2 * colGap;
        x = (totalGridWidth - dim.width) / 2;
      }
      
      domainPositions[domainId] = {
        x: x,
        y: y,
        width: dim.width,
        height: dim.height,
        name: domain.name,
        viName: domain.vietnamese_name,
        color: domain.color,
        description: domain.description
      };
      
      // Cache absolute coordinates of each node in this domain
      const layout = layoutsByDomain[domainId];
      if (layout && layout.children) {
        layout.children.forEach(node => {
          absoluteNodeCoords[node.id] = {
            id: node.id,
            x: x + domainPaddingLeft + node.x,
            y: y + domainPaddingTop + node.y,
            width: node.width,
            height: node.height,
            domainId: domainId
          };
        });
      }
    });
  });

  // 5. Draw Domain Containers
  Object.entries(domainPositions).forEach(([id, pos]) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', `domain-${id}`);
    g.setAttribute('class', 'domain-group');
    g.setAttribute('data-domain-id', id);
    
    // Large background rectangle
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'domain-rect');
    rect.setAttribute('x', pos.x);
    rect.setAttribute('y', pos.y);
    rect.setAttribute('width', pos.width);
    rect.setAttribute('height', pos.height);
    rect.setAttribute('stroke', pos.color);
    rect.setAttribute('fill', 'rgba(15, 23, 42, 0.45)');
    g.appendChild(rect);
    
    // Colored top border accent line
    const accentLine = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    accentLine.setAttribute('x', pos.x + 15);
    accentLine.setAttribute('y', pos.y + 15);
    accentLine.setAttribute('width', pos.width - 30);
    accentLine.setAttribute('height', 6);
    accentLine.setAttribute('rx', 3);
    accentLine.setAttribute('fill', pos.color);
    g.appendChild(accentLine);
    
    // Domain Header text
    const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    titleText.setAttribute('class', 'domain-title-text');
    titleText.setAttribute('x', pos.x + 25);
    titleText.setAttribute('y', pos.y + 45);
    titleText.textContent = `${id} - ${pos.viName}`;
    textGroup.appendChild(titleText);
    
    // Domain description (wrap text if too long)
    const descText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    descText.setAttribute('class', 'domain-desc-text');
    descText.setAttribute('x', pos.x + 25);
    descText.setAttribute('y', pos.y + 62);
    
    let desc = pos.description;
    if (desc.length > 70) {
      desc = desc.substring(0, 68) + '...';
    }
    descText.textContent = desc;
    textGroup.appendChild(descText);
    
    g.appendChild(textGroup);
    domainsGroup.appendChild(g);
  });

  // 6. Draw Nodes (Objects)
  ontologyData.objects.forEach(obj => {
    const coords = absoluteNodeCoords[obj.id];
    if (!coords) return;
    
    const domain = ontologyData.domains.find(d => d.id === obj.domain_id);
    const domainColor = domain ? domain.color : '#64748b';
    
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', `node-${obj.id}`);
    g.setAttribute('class', 'node-group');
    g.setAttribute('data-domain-id', obj.domain_id);
    g.setAttribute('data-object-id', obj.id);
    
    // Card main background
    const cardRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    cardRect.setAttribute('class', 'node-rect');
    cardRect.setAttribute('x', coords.x);
    cardRect.setAttribute('y', coords.y);
    cardRect.setAttribute('width', coords.width);
    cardRect.setAttribute('height', coords.height);
    g.appendChild(cardRect);
    
    // Card Header background (colored band)
    const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    headerRect.setAttribute('class', 'node-header-rect');
    headerRect.setAttribute('x', coords.x + 1.5);
    headerRect.setAttribute('y', coords.y + 1.5);
    headerRect.setAttribute('width', coords.width - 3);
    headerRect.setAttribute('height', 36);
    headerRect.setAttribute('fill', domainColor);
    headerRect.style.opacity = 0.85;
    g.appendChild(headerRect);
    
    // Header overlay for rounded corners fix
    const coverRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    coverRect.setAttribute('x', coords.x + 1.5);
    coverRect.setAttribute('y', coords.y + 20);
    coverRect.setAttribute('width', coords.width - 3);
    coverRect.setAttribute('height', 18);
    coverRect.setAttribute('fill', domainColor);
    coverRect.style.opacity = 0.85;
    g.appendChild(coverRect);
    
    // Card Name Text (English)
    const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    nameText.setAttribute('class', 'node-header-text');
    nameText.setAttribute('x', coords.x + 15);
    nameText.setAttribute('y', coords.y + 22);
    nameText.textContent = obj.name;
    g.appendChild(nameText);
    
    // Card Name Text (Vietnamese)
    const nameViText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    nameViText.setAttribute('class', 'node-header-vi');
    nameViText.setAttribute('x', coords.x + coords.width - 15);
    nameViText.setAttribute('y', coords.y + 22);
    nameViText.setAttribute('text-anchor', 'end');
    nameViText.textContent = obj.vietnamese_name;
    g.appendChild(nameViText);
    
    // Properties list rendering
    let propY = coords.y + 58;
    obj.properties.forEach((prop, pIdx) => {
      // Draw property name
      const propText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      propText.setAttribute('class', 'node-property-text');
      propText.setAttribute('x', coords.x + 35);
      propText.setAttribute('y', propY);
      
      let pName = prop.name;
      if (pName.length > 20) pName = pName.substring(0, 18) + '..';
      propText.textContent = pName;
      g.appendChild(propText);
      
      // Draw key indicator icon (PK / FK)
      if (prop.is_pk) {
        const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badgeBg.setAttribute('class', 'node-property-badge-bg');
        badgeBg.setAttribute('x', coords.x + 14);
        badgeBg.setAttribute('y', propY - 9);
        badgeBg.setAttribute('width', 16);
        badgeBg.setAttribute('height', 11);
        badgeBg.setAttribute('fill', '#eab308');
        g.appendChild(badgeBg);
        
        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('class', 'node-property-badge-text');
        badgeText.setAttribute('x', coords.x + 22);
        badgeText.setAttribute('y', propY - 1);
        badgeText.setAttribute('fill', '#000000');
        badgeText.textContent = 'PK';
        g.appendChild(badgeText);
      } else if (prop.is_fk) {
        const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badgeBg.setAttribute('class', 'node-property-badge-bg');
        badgeBg.setAttribute('x', coords.x + 14);
        badgeBg.setAttribute('y', propY - 9);
        badgeBg.setAttribute('width', 16);
        badgeBg.setAttribute('height', 11);
        badgeBg.setAttribute('fill', '#3b82f6');
        g.appendChild(badgeBg);
        
        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('class', 'node-property-badge-text');
        badgeText.setAttribute('x', coords.x + 22);
        badgeText.setAttribute('y', propY - 1);
        badgeText.setAttribute('fill', '#ffffff');
        badgeText.textContent = 'FK';
        g.appendChild(badgeText);
      } else {
        // Draw simple bullet
        const bullet = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bullet.setAttribute('cx', coords.x + 22);
        bullet.setAttribute('cy', propY - 4);
        bullet.setAttribute('r', 2);
        bullet.setAttribute('fill', '#64748b');
        g.appendChild(bullet);
      }
      
      // Draw datatype
      const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      typeText.setAttribute('class', 'node-property-type');
      typeText.setAttribute('x', coords.x + coords.width - 15);
      typeText.setAttribute('y', propY);
      typeText.style.display = showDatatypes ? 'block' : 'none';
      
      let dType = prop.datatype;
      if (dType.length > 12) dType = dType.substring(0, 10) + '..';
      typeText.textContent = dType;
      g.appendChild(typeText);
      
      // Separator line between properties
      if (pIdx < obj.properties.length - 1) {
        const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        divider.setAttribute('class', 'node-divider');
        divider.setAttribute('x1', coords.x + 12);
        divider.setAttribute('y1', propY + 6);
        divider.setAttribute('x2', coords.x + coords.width - 12);
        divider.setAttribute('y2', propY + 6);
        g.appendChild(divider);
      }
      
      propY += 22;
    });
    
    // Add Click listener to select object
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      selectObject(obj);
    });
    
    // Hover effects to highlight paths
    g.addEventListener('mouseenter', () => highlightConnections(obj.id));
    g.addEventListener('mouseleave', resetHighlight);
    
    nodesGroup.appendChild(g);
  });

  // 7. Draw Intra-Domain Edges (local inside each domain)
  ontologyData.domains.forEach(domain => {
    const layout = layoutsByDomain[domain.id];
    if (!layout || !layout.edges) return;
    
    const pos = domainPositions[domain.id];
    const dx = pos.x + domainPaddingLeft;
    const dy = pos.y + domainPaddingTop;
    
    layout.edges.forEach((edge, edgeIdx) => {
      const rel = intraRelsByDomain[domain.id][edgeIdx];
      if (!rel) return;
      
      // Build SVG path d string from sections
      let d = "";
      if (edge.sections) {
        edge.sections.forEach(sec => {
          d += `M ${sec.startPoint.x + dx} ${sec.startPoint.y + dy} `;
          if (sec.bendPoints) {
            sec.bendPoints.forEach(bp => {
              d += `L ${bp.x + dx} ${bp.y + dy} `;
            });
          }
          d += `L ${sec.endPoint.x + dx} ${sec.endPoint.y + dy}`;
        });
      }
      
      if (!d) return;
      
      // Draw Edge path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('id', `edge-${domain.id}-${edgeIdx}`);
      path.setAttribute('class', 'edge-path');
      path.setAttribute('data-domain-id', domain.id);
      path.setAttribute('data-source', rel.source);
      path.setAttribute('data-target', rel.target);
      path.setAttribute('d', d);
      path.setAttribute('stroke', domain.color);
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', `url(#arrow-${domain.id})`);
      edgesGroup.appendChild(path);
      
      // Add relationship label at the midpoint
      if (edge.sections && edge.sections[0]) {
        const sec = edge.sections[0];
        let midX = (sec.startPoint.x + sec.endPoint.x) / 2 + dx;
        let midY = (sec.startPoint.y + sec.endPoint.y) / 2 + dy;
        
        if (sec.bendPoints && sec.bendPoints.length > 0) {
          const bp = sec.bendPoints[Math.floor(sec.bendPoints.length / 2)];
          midX = bp.x + dx;
          midY = bp.y + dy;
        }
        
        drawEdgeLabel(edgesGroup, midX, midY, rel.type, domain.id);
      }
    });
  });

  // 8. Draw Inter-Domain Edges (Cross-domain relationships)
  crossDomainRels.forEach((rel, idx) => {
    const srcCoords = absoluteNodeCoords[rel.source];
    const tgtCoords = absoluteNodeCoords[rel.target];
    if (!srcCoords || !tgtCoords) return;
    
    // Find closest ports
    // Source: right side center
    const x1 = srcCoords.x + srcCoords.width;
    const y1 = srcCoords.y + srcCoords.height / 2;
    
    // Target: left side center
    const x2 = tgtCoords.x;
    const y2 = tgtCoords.y + tgtCoords.height / 2;
    
    // Draw smooth cubic Bezier path
    const dx = Math.abs(x2 - x1);
    const cp1x = x1 + dx * 0.4;
    const cp1y = y1;
    const cp2x = x2 - dx * 0.4;
    const cp2y = y2;
    
    const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('id', `edge-cross-${idx}`);
    path.setAttribute('class', 'edge-path cross-domain');
    path.setAttribute('data-source', rel.source);
    path.setAttribute('data-target', rel.target);
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#64748b'); // Slate neutral color for cross domain
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrow-default)');
    
    // Hide if toggle is unchecked
    path.style.display = showCrossDomain ? 'block' : 'none';
    edgesGroup.appendChild(path);
    
    // Midpoint coordinates for label
    // Cubic bezier midpoint calculation for t=0.5
    const midX = 0.125 * x1 + 0.375 * cp1x + 0.375 * cp2x + 0.125 * x2;
    const midY = 0.125 * y1 + 0.375 * cp1y + 0.375 * cp2y + 0.125 * y2;
    
    drawEdgeLabel(edgesGroup, midX, midY - 8, rel.type, 'cross', true);
  });
  
  // Set initial viewport zoom fit
  setTimeout(resetView, 100);
}

function drawEdgeLabel(parentGroup, x, y, text, domainId, isCrossDomain = false) {
  if (!text) return;
  
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', `edge-label-group ${isCrossDomain ? 'cross-domain' : ''}`);
  if (!isCrossDomain) {
    g.setAttribute('data-domain-id', domainId);
  }
  g.style.display = (isCrossDomain && !showCrossDomain) ? 'none' : 'block';
  
  // Create virtual text to calculate length
  const tempText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  tempText.setAttribute('class', 'edge-label-text');
  tempText.textContent = text;
  
  // Add to parent temporarily to measure width
  svg.appendChild(tempText);
  const textWidth = Math.max(tempText.getComputedTextLength() + 10, 30);
  svg.removeChild(tempText);
  
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'edge-label-bg');
  rect.setAttribute('x', x - textWidth / 2);
  rect.setAttribute('y', y - 6);
  rect.setAttribute('width', textWidth);
  rect.setAttribute('height', 12);
  g.appendChild(rect);
  
  const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textEl.setAttribute('class', 'edge-label-text');
  textEl.setAttribute('x', x);
  textEl.setAttribute('y', y + 3);
  textEl.textContent = text;
  g.appendChild(textEl);
  
  parentGroup.appendChild(g);
}

// Highlight connections on Hover
function highlightConnections(nodeId) {
  if (activeDomainFilter) return; // Ignore if domain filter is active
  
  const connectedNodeIds = new Set([nodeId]);
  
  // Find connected paths
  document.querySelectorAll('.edge-path').forEach(path => {
    const src = path.getAttribute('data-source');
    const tgt = path.getAttribute('data-target');
    
    if (src === nodeId || tgt === nodeId) {
      path.classList.add('highlighted');
      connectedNodeIds.add(src);
      connectedNodeIds.add(tgt);
    } else {
      path.classList.add('dimmed');
    }
  });
  
  // Dim other nodes
  document.querySelectorAll('.node-group').forEach(node => {
    const objId = node.getAttribute('data-object-id');
    if (connectedNodeIds.has(objId)) {
      node.classList.remove('dimmed');
      if (objId !== nodeId) {
        node.classList.add('highlighted-node');
      }
    } else {
      node.classList.add('dimmed');
    }
  });
  
  // Dim all domains
  document.querySelectorAll('.domain-group').forEach(el => el.classList.add('dimmed'));
  
  // Highlight domain container of connected nodes
  connectedNodeIds.forEach(id => {
    const obj = ontologyData.objects.find(o => o.id === id);
    if (obj) {
      const domEl = document.getElementById(`domain-${obj.domain_id}`);
      if (domEl) domEl.classList.remove('dimmed');
    }
  });
  
  // Dim local edge labels
  document.querySelectorAll('.edge-label-group').forEach(g => {
    // Check if it belongs to highlighted edge
    let isConnected = false;
    document.querySelectorAll('.edge-path.highlighted').forEach(path => {
      // Very simple approximation: since label positions map, we can match
      // but easier is just checking if we should dim it.
    });
    g.classList.add('dimmed');
  });
}

// Select Object to show Details
function selectObject(obj) {
  // Update selection CSS class
  document.querySelectorAll('.node-group').forEach(el => el.classList.remove('selected'));
  const nodeEl = document.getElementById(`node-${obj.id}`);
  if (nodeEl) nodeEl.classList.add('selected');
  
  currentSelection = obj;
  
  // Show Details Panel
  document.getElementById('details-placeholder').classList.add('hidden');
  const detailsContent = document.getElementById('details-content');
  detailsContent.classList.remove('hidden');
  
  // Get domain details
  const domain = ontologyData.domains.find(d => d.id === obj.domain_id);
  const domainName = domain ? domain.vietnamese_name : 'Unknown';
  const domainColor = domain ? domain.color : '#2563eb';
  
  detailsContent.innerHTML = `
    <div class="obj-domain-badge" style="background-color: ${domainColor}20; color: ${domainColor}; border: 1px solid ${domainColor}40">
      <i class="fa-solid fa-folder-open"></i> ${domain.id} - ${domainName}
    </div>
    <h2>${obj.name}</h2>
    <div style="font-size: 14px; color: var(--text-muted); margin-top: -2px; margin-bottom: 12px; font-weight: 500;">
      ${obj.vietnamese_name}
    </div>
    
    <div class="obj-meta-grid">
      <div class="meta-item">
        <div class="meta-label">Object Category</div>
        <div class="meta-value" style="color: ${domainColor};">${obj.category || 'N/A'}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">Owner/Actor</div>
        <div class="meta-value">${obj.owner || 'N/A'}</div>
      </div>
    </div>
    
    ${obj.description ? `<div class="obj-desc">${obj.description}</div>` : ''}
    
    <div class="details-tabs">
      <button class="tab-btn ${currentTab === 'properties' ? 'active' : ''}" onclick="switchTab('properties')">Properties (${obj.properties.length})</button>
      <button class="tab-btn ${currentTab === 'rules' ? 'active' : ''}" onclick="switchTab('rules')">Business Rules (${obj.policies.length})</button>
      <button class="tab-btn ${currentTab === 'actions' ? 'active' : ''}" onclick="switchTab('actions')">Actions/Events (${obj.actions.length})</button>
    </div>
    
    <div id="tab-content">
      <!-- Dynamic tab content -->
    </div>
  `;
  
  renderTabContent();
  
  // Center camera on selected object
  const coords = absoluteNodeCoords[obj.id];
  if (coords) {
    zoomToRect(coords.x - 100, coords.y - 100, coords.width + 200, coords.height + 200);
  }
}

// Switch tabs in detail view
window.switchTab = function(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.innerText.toLowerCase().includes(tabName === 'properties' ? 'properties' : tabName === 'rules' ? 'rules' : 'actions')) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  renderTabContent();
}

function renderTabContent() {
  const container = document.getElementById('tab-content');
  if (!currentSelection || !container) return;
  
  container.innerHTML = '';
  
  if (currentTab === 'properties') {
    if (currentSelection.properties.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Không có thuộc tính nào.</div>';
      return;
    }
    
    const list = document.createElement('div');
    list.className = 'props-list';
    
    currentSelection.properties.forEach(prop => {
      const card = document.createElement('div');
      card.className = 'prop-card';
      
      const badgeHTML = `
        ${prop.is_pk ? '<span class="badge-pk">PK</span>' : ''}
        ${prop.is_fk ? `<span class="badge-fk" title="FK to ${prop.fk_target}">FK</span>` : ''}
        ${prop.required ? '<span class="badge-req">Req</span>' : ''}
        ${prop.conditional ? '<span class="badge-sensitive" style="background-color: rgba(234, 88, 12, 0.15); color: #ea580c;">Cond</span>' : ''}
        ${prop.sensitive ? '<span class="badge-sensitive">Private</span>' : ''}
      `;
      
      card.innerHTML = `
        <div class="prop-left">
          <div class="prop-name-row">
            <span class="prop-name">${prop.name}</span>
            ${badgeHTML}
          </div>
          <span class="prop-vi">${prop.vietnamese_name}</span>
          ${prop.rule_usage ? `<span class="prop-desc"><i class="fa-solid fa-code-branch"></i> ${prop.rule_usage}</span>` : ''}
          ${prop.erd_mapping ? `<span class="prop-desc" style="font-family: monospace; font-size: 10px;"><i class="fa-solid fa-database"></i> DB mapping: ${prop.erd_mapping}</span>` : ''}
        </div>
        <div class="prop-right">
          <span class="prop-type">${prop.datatype}</span>
        </div>
      `;
      list.appendChild(card);
    });
    
    container.appendChild(list);
  } 
  else if (currentTab === 'rules') {
    if (currentSelection.policies.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Không có business rule nào được áp dụng cho object này.</div>';
      return;
    }
    
    currentSelection.policies.forEach(policy => {
      const card = document.createElement('div');
      card.className = `policy-card severity-${policy.severity.toLowerCase()}`;
      
      card.innerHTML = `
        <div class="policy-header">
          <span class="policy-title">${policy.rule_name}</span>
          <span class="policy-badge" style="color: ${policy.severity === 'High' ? '#ef4444' : policy.severity === 'Medium' ? '#f97316' : '#10b981'}">${policy.rule_type}</span>
        </div>
        <div class="policy-desc">${policy.policy}</div>
        ${policy.input_properties ? `<div class="policy-expr">${policy.input_properties}</div>` : ''}
      `;
      container.appendChild(card);
    });
  } 
  else if (currentTab === 'actions') {
    if (currentSelection.actions.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Không có action/event nào được định nghĩa cho object này.</div>';
      return;
    }
    
    currentSelection.actions.forEach(action => {
      const card = document.createElement('div');
      card.className = 'action-card';
      
      card.innerHTML = `
        <div class="action-header">
          <span class="action-title">${action.action_name}</span>
          <span class="action-actor"><i class="fa-solid fa-user-gear"></i> ${action.actor}</span>
        </div>
        <div style="font-size: 12px; margin-bottom: 8px; color: var(--text-main); font-weight: 500;">
          Event: <span style="font-family: monospace; color: #3b82f6;">${action.event_name}</span> (${action.event_vietnamese})
        </div>
        <div class="action-flow">
          <span class="state-bubble">${action.current_state || 'ANY'}</span> 
          <i class="fa-solid fa-arrow-right-long"></i> 
          <span class="state-bubble" style="color: #10b981;">${action.next_state}</span>
        </div>
      `;
      container.appendChild(card);
    });
  }
}

// SVG / PNG / PDF Exporting Handlers
// 1. Export SVG
function exportToSVG() {
  try {
    const svgClone = svg.cloneNode(true);
    
    // Remove grid pattern background for clean export if desired
    // Or set viewport scale appropriately
    
    // Get full graph bounds to set size
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    Object.values(domainPositions).forEach(pos => {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    });
    
    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = 2000; maxY = 2000;
    } else {
      // Add margin
      minX -= 50;
      minY -= 50;
      maxX += 50;
      maxY += 50;
    }
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Configure viewport of export SVG
    const exportViewport = svgClone.getElementById('viewport-group');
    exportViewport.removeAttribute('transform');
    
    svgClone.setAttribute('width', width);
    svgClone.setAttribute('height', height);
    svgClone.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    
    // Add custom style block to embed CSS in SVG
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    // Fetch style.css content and embed it
    fetch('style.css')
      .then(r => r.text())
      .then(css => {
        styleEl.textContent = css;
        svgClone.insertBefore(styleEl, svgClone.firstChild);
        
        const svgString = new XMLSerializer().serializeToString(svgClone);
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        
        const downloadLink = document.createElement('a');
        downloadLink.href = svgUrl;
        downloadLink.download = 'f88-claims-ontology.svg';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(svgUrl);
      });
  } catch (err) {
    console.error("Export SVG error:", err);
    alert("Không thể export SVG: " + err.message);
  }
}

// 2. Export PNG
function exportToPNG() {
  alert("Vui lòng sử dụng script export.js để sinh file PNG chất lượng cao, hoặc sử dụng tính năng in của trình duyệt.");
}

// 3. Export PDF
function exportToPDF() {
  alert("Vui lòng sử dụng script export.js để sinh file PDF chất lượng cao, hoặc Ctrl+P để in trang ra PDF.");
}
