const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log('Starting export process using Puppeteer...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Attach console and error log listeners
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.toString()));
  
  // Create absolute path to index.html
  const indexPath = path.resolve(__dirname, 'web', 'index.html');
  const fileUrl = `file://${indexPath}`;
  
  console.log(`Loading page: ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  
  // Wait a moment for ELK layout and rendering to complete
  console.log('Waiting for layout engine to finish rendering...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Get SVG bounding box
  const bbox = await page.evaluate(() => {
    const viewportGroup = document.getElementById('viewport-group');
    if (!viewportGroup) return null;
    const bbox = viewportGroup.getBBox();
    return {
      x: bbox.x,
      y: bbox.y,
      width: bbox.width,
      height: bbox.height
    };
  });
  
  if (!bbox) {
    console.error('Failed to get graph bounding box. Is the SVG empty?');
    await browser.close();
    process.exit(1);
  }
  
  console.log('Graph bounding box:', bbox);
  
  // Ensure export folder exists
  const exportDir = path.join(__dirname, 'export');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir);
  }
  
  // 1. Export SVG
  console.log('Generating SVG file...');
  const svgContent = await page.evaluate((box) => {
    const svgEl = document.getElementById('graph-svg').cloneNode(true);
    
    // Adjust svg dimensions to match the bounding box with margin
    const margin = 50;
    const width = box.width + margin * 2;
    const height = box.height + margin * 2;
    const minX = box.x - margin;
    const minY = box.y - margin;
    
    svgEl.setAttribute('width', width);
    svgEl.setAttribute('height', height);
    svgEl.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    
    // Remove transform on viewport-group inside clone so it uses raw coordinates
    const viewport = svgEl.querySelector('#viewport-group');
    if (viewport) {
      viewport.removeAttribute('transform');
    }
    
    // Serialize SVG
    return new XMLSerializer().serializeToString(svgEl);
  }, bbox);
  
  const svgPath = path.join(exportDir, 'ontology.svg');
  fs.writeFileSync(svgPath, svgContent, 'utf8');
  console.log(`SVG exported to: ${svgPath}`);
  
  // 2. Export PNG
  // Resize viewport to match graph size + margins and center it
  console.log('Preparing page viewport for PNG export...');
  const margin = 50;
  const viewWidth = Math.ceil(bbox.width + margin * 2);
  const viewHeight = Math.ceil(bbox.height + margin * 2);
  
  // Position the graph in the center of page without scale
  await page.evaluate((box, marg) => {
    // Hide sidebars and panels for clean poster export
    const sidebar = document.querySelector('.app-sidebar');
    if (sidebar) sidebar.style.display = 'none';
    
    const header = document.querySelector('.app-header');
    if (header) header.style.display = 'none';
    
    const legend = document.querySelector('.legend-panel');
    if (legend) legend.style.display = 'none';
    
    const zoomCtrl = document.querySelector('.zoom-controls');
    if (zoomCtrl) zoomCtrl.style.display = 'none';
    
    // Reset body background so it screenshots cleanly
    document.body.style.backgroundColor = '#0b0f19';
    
    // Position viewport group
    const viewportGroup = document.getElementById('viewport-group');
    if (viewportGroup) {
      const tx = -box.x + marg;
      const ty = -box.y + marg;
      viewportGroup.setAttribute('transform', `translate(${tx}, ${ty}) scale(1)`);
    }
    
    // Set canvas container to take exact size
    const container = document.getElementById('canvas-container');
    if (container) {
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
    }
    
    const svgEl = document.getElementById('graph-svg');
    if (svgEl) {
      svgEl.setAttribute('width', '100%');
      svgEl.setAttribute('height', '100%');
    }
  }, bbox, margin);
  
  // Set browser viewport size
  await page.setViewport({
    width: viewWidth,
    height: viewHeight,
    deviceScaleFactor: 2 // High resolution scale
  });
  
  console.log(`Taking PNG screenshot with viewport: ${viewWidth}x${viewHeight}...`);
  const pngPath = path.join(exportDir, 'ontology.png');
  await page.screenshot({
    path: pngPath,
    clip: {
      x: 0,
      y: 0,
      width: viewWidth,
      height: viewHeight
    }
  });
  console.log(`PNG exported to: ${pngPath}`);
  
  // 3. Export PDF
  console.log('Generating PDF file...');
  const pdfPath = path.join(exportDir, 'ontology.pdf');
  await page.pdf({
    path: pdfPath,
    width: `${viewWidth}px`,
    height: `${viewHeight}px`,
    printBackground: true,
    margin: {
      top: '0px',
      bottom: '0px',
      left: '0px',
      right: '0px'
    }
  });
  console.log(`PDF exported to: ${pdfPath}`);
  
  await browser.close();
  console.log('Export process completed successfully!');
})();
