import json
import os

def main():
    # Load ontology JSON
    with open("web/ontology.json", "r", encoding="utf-8") as f:
        data = json.load(f)
        
    domains = data["domains"]
    objects = data["objects"]
    relationships = data["relationships"]
    
    # Map domain ID to domain info
    domain_map = {d["id"]: d for d in domains}
    
    # Map object ID to its domain ID
    object_to_domain = {obj["id"]: obj["domain_id"] for obj in objects}
    object_map = {obj["id"]: obj for obj in objects}
    
    # ----------------------------------------------------
    # 1. High-Level Domain Relationships
    # ----------------------------------------------------
    # Calculate links between domains
    domain_links = set()
    for rel in relationships:
        src = rel["source"]
        tgt = rel["target"]
        src_dom = object_to_domain.get(src)
        tgt_dom = object_to_domain.get(tgt)
        if src_dom and tgt_dom and src_dom != tgt_dom:
            domain_links.add((src_dom, tgt_dom))
            
    # Build High-Level Domain Flow Mermaid
    hl_mermaid = []
    hl_mermaid.append("```mermaid")
    hl_mermaid.append("flowchart TD")
    hl_mermaid.append("    %% High-level Domain Flow Diagram")
    
    # Define domain nodes
    for d in domains:
        name_clean = f"\"{d['id']} - {d['vietnamese_name']}\""
        hl_mermaid.append(f"    {d['id']}[{name_clean}]")
        
    hl_mermaid.append("")
    # Add links
    for src_dom, tgt_dom in sorted(list(domain_links)):
        hl_mermaid.append(f"    {src_dom} --> {tgt_dom}")
        
    # Styles for domains
    hl_mermaid.append("")
    for d in domains:
        hl_mermaid.append(f"    style {d['id']} fill:{d['color']}15,stroke:{d['color']},stroke-width:2px")
        
    hl_mermaid.append("```")
    hl_mermaid_str = "\n".join(hl_mermaid)
    
    # ----------------------------------------------------
    # 2. Detailed Ontology Diagram
    # ----------------------------------------------------
    dt_mermaid = []
    dt_mermaid.append("```mermaid")
    dt_mermaid.append("flowchart TD")
    dt_mermaid.append("    %% Detailed Object-level Ontology Diagram")
    
    # Group objects by domain
    domain_objects = {d["id"]: [] for d in domains}
    for obj in objects:
        dom_id = obj["domain_id"]
        if dom_id in domain_objects:
            domain_objects[dom_id].append(obj)
            
    # Write subgraphs
    for d in domains:
        dom_id = d["id"]
        name_clean = f"\"{d['id']} - {d['vietnamese_name']}\""
        dt_mermaid.append(f"    subgraph {dom_id} [{name_clean}]")
        for obj in domain_objects[dom_id]:
            obj_label = f"\"{obj['id']}\\n({obj['vietnamese_name']})\""
            dt_mermaid.append(f"        {obj['id']}[{obj_label}]")
        dt_mermaid.append("    end")
        dt_mermaid.append("")
        
    # Write relationships
    for rel in relationships:
        src = rel["source"]
        tgt = rel["target"]
        rtype = rel["type"]
        card = rel.get("cardinality", "")
        
        # Determine link styling (dashed for cross-domain)
        src_dom = object_to_domain.get(src)
        tgt_dom = object_to_domain.get(tgt)
        
        # Escaping quotes for safety in node labels
        link_label = f"\"{rtype} ({card})\""
        if src_dom != tgt_dom:
            # Cross-domain links
            dt_mermaid.append(f"    {src} -.->|{link_label}| {tgt}")
        else:
            # Intra-domain links
            dt_mermaid.append(f"    {src} -->|{link_label}| {tgt}")
            
    # Add domain container styling in detailed view
    dt_mermaid.append("")
    for d in domains:
        dt_mermaid.append(f"    style {d['id']} fill:{d['color']}08,stroke:{d['color']},stroke-dasharray: 5 5")
        
    dt_mermaid.append("```")
    dt_mermaid_str = "\n".join(dt_mermaid)
    
    # ----------------------------------------------------
    # 3. Save to Artifact markdown file
    # ----------------------------------------------------
    md_content = f"""# F88 Claims Ontology Mermaid Diagrams

This document contains the visual representation of the F88 Claims Ontology using Mermaid diagrams.

## 1. High-Level Domain Relationship Flow
This diagram illustrates the relationship and flow of information between the 10 business domains.

{hl_mermaid_str}

## 2. Detailed Object-Level Ontology Diagram
This diagram shows every individual object/entity grouped by their business domain, as well as their internal and cross-domain relationships.

> [!NOTE]
> Solid arrows (`-->`) denote intra-domain relationships.
> Dashed arrows (`-.->`) denote cross-domain relationships.

{dt_mermaid_str}
"""
    
    # Make sure artifacts folder exists
    os.makedirs("artifacts", exist_ok=True)
    with open("artifacts/ontology_mermaid.md", "w", encoding="utf-8") as f:
        f.write(md_content)
        
    print("Mermaid diagrams generated successfully at: artifacts/ontology_mermaid.md")

if __name__ == "__main__":
    main()
