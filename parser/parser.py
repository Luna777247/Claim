import os
import pandas as pd
import json
import re

def clean_string(val):
    if pd.isna(val):
        return ""
    return str(val).strip()

def parse_excel():
    excel_path = "Ontology_Claims_F88.xlsx"
    if not os.path.exists(excel_path):
        excel_path = "../Ontology_Claims_F88.xlsx"
        if not os.path.exists(excel_path):
            excel_path = "data/Ontology_Claims_F88.xlsx"

    print(f"Reading Excel from: {excel_path}")
    
    # Read sheets
    df_domain_list = pd.read_excel(excel_path, sheet_name="99_Lists")
    df_domain_obj = pd.read_excel(excel_path, sheet_name="01_DomainObject")
    df_props = pd.read_excel(excel_path, sheet_name="02_ObjectProperties")
    df_rels = pd.read_excel(excel_path, sheet_name="03_ObjectRelationship")
    
    try:
        df_policies = pd.read_excel(excel_path, sheet_name="04_ObjectPolicy")
    except Exception:
        df_policies = pd.DataFrame()
        print("Warning: 04_ObjectPolicy sheet not found or failed to read")
        
    try:
        df_actions = pd.read_excel(excel_path, sheet_name="05_ActionEvent")
    except Exception:
        df_actions = pd.DataFrame()
        print("Warning: 05_ActionEvent sheet not found or failed to read")

    # 1. Map Domain ID to Domain Name and other list data
    # We can extract domain list from 99_Lists sheet.
    domain_map = {}
    if 'Domain ID' in df_domain_list.columns and 'Domain Name' in df_domain_list.columns:
        domain_sub = df_domain_list[['Domain ID', 'Domain Name']].dropna().drop_duplicates()
        for _, row in domain_sub.iterrows():
            d_id = clean_string(row['Domain ID'])
            d_name = clean_string(row['Domain Name'])
            domain_map[d_name] = d_id
            
    # Default colors for the 10 domains
    domain_colors = {
        "D01": "#3b82f6", # Blue
        "D02": "#10b981", # Green
        "D03": "#8b5cf6", # Purple
        "D04": "#f97316", # Orange
        "D05": "#06b6d4", # Cyan
        "D06": "#ef4444", # Red
        "D07": "#eab308", # Amber
        "D08": "#ec4899", # Pink
        "D09": "#64748b", # Slate
        "D10": "#14b8a6", # Teal
    }

    # Extract Domains from 01_DomainObject
    # A domain row has Object Category == 'Domain'
    domains = []
    domain_rows = df_domain_obj[df_domain_obj['Object Category'] == 'Domain']
    
    # If no Domain category found, extract from DomainRoots
    if len(domain_rows) == 0:
        domain_rows = df_domain_obj[df_domain_obj['Object Type'] == 'DomainRoot']

    for _, row in domain_rows.iterrows():
        d_name = clean_string(row['Domain Name'])
        path = clean_string(row['Hierarchy Path'])
        # Try to find domain ID from hierarchy path (e.g. "D01 Partner...") or domain_map
        d_id = ""
        m = re.match(r'^(D\d+)', path)
        if m:
            d_id = m.group(1)
        elif d_name in domain_map:
            d_id = domain_map[d_name]
        else:
            # Generate fallback ID
            d_id = f"D{len(domains)+1:02d}"
            
        color = domain_colors.get(d_id, "#6c757d")
        
        domains.append({
            "id": d_id,
            "name": d_name,
            "vietnamese_name": clean_string(row['Tên tiếng Việt']),
            "description": clean_string(row['Description']),
            "owner": clean_string(row.get('Owner/Actor', '')),
            "color": color
        })

    # Index domains by ID and name
    domain_by_id = {d['id']: d for d in domains}
    domain_id_by_name = {d['name']: d['id'] for d in domains}

    # 2. Extract Objects from 01_DomainObject
    # Objects are rows where Object Category is NOT 'Domain' and Object Type is NOT 'DomainRoot'
    objects = []
    object_rows = df_domain_obj[
        (df_domain_obj['Object Category'] != 'Domain') & 
        (df_domain_obj['Object Type'] != 'DomainRoot') &
        (df_domain_obj['Object Type'].notna())
    ]

    for _, row in object_rows.iterrows():
        obj_type = clean_string(row['Object Type'])
        d_name = clean_string(row['Domain Name'])
        
        # Get domain ID
        d_id = ""
        path = clean_string(row['Hierarchy Path'])
        m = re.match(r'^(D\d+)', path)
        if m:
            d_id = m.group(1)
        elif d_name in domain_id_by_name:
            d_id = domain_id_by_name[d_name]
        else:
            d_id = "D01" # fallback
            
        objects.append({
            "id": obj_type,
            "name": obj_type,
            "vietnamese_name": clean_string(row['Tên tiếng Việt']),
            "category": clean_string(row['Object Category']),
            "parent_object": clean_string(row['Parent Object']),
            "domain_id": d_id,
            "owner": clean_string(row.get('Owner/Actor', '')),
            "description": clean_string(row['Description']),
            "properties": [],
            "policies": [],
            "actions": []
        })

    object_by_id = {obj['id']: obj for obj in objects}

    # 3. Extract Properties from 02_ObjectProperties
    for _, row in df_props.iterrows():
        obj_type = clean_string(row['Object Type'])
        prop_name = clean_string(row['Property Name'])
        if not obj_type or not prop_name:
            continue
            
        is_pk = clean_string(row.get('Property Classification', '')) == 'Identifier'
        
        prop_data = {
            "name": prop_name,
            "vietnamese_name": clean_string(row.get('Tên thuộc tính tiếng Việt', '')),
            "datatype": clean_string(row.get('Data Type đề xuất', 'String')),
            "classification": clean_string(row.get('Property Classification', 'Core')),
            "required": clean_string(row.get('Required?', 'No')) in ['Yes', 'Y'],
            "conditional": clean_string(row.get('Required?', 'No')) == 'Conditional',
            "sensitive": clean_string(row.get('Sensitive?', 'No')) in ['Yes', 'Y'],
            "scope": clean_string(row.get('Core/Dynamic/Snapshot/Audit', 'Core')),
            "rule_usage": clean_string(row.get('Rule/State Usage', '')),
            "erd_mapping": clean_string(row.get('ERD Column / Mapping', '')),
            "is_pk": is_pk,
            "is_fk": False # Will resolve later
        }
        
        # If object exists, add property to it
        if obj_type in object_by_id:
            object_by_id[obj_type]['properties'].append(prop_data)
        elif obj_type == "Claim/FNOL":
            # Add to both Claim and FNOL
            for target_obj in ["Claim", "FNOL"]:
                if target_obj in object_by_id:
                    # Deep copy and add
                    import copy
                    copied_prop = copy.deepcopy(prop_data)
                    object_by_id[target_obj]['properties'].append(copied_prop)

    # 4. Extract Policies from 04_ObjectPolicy
    if not df_policies.empty:
        for _, row in df_policies.iterrows():
            scope_str = clean_string(row.get('Object Scope', ''))
            if not scope_str:
                continue
            # Scope can be comma or semicolon separated
            scopes = [s.strip() for s in re.split(r'[;,]', scope_str) if s.strip()]
            
            policy_data = {
                "rule_name": clean_string(row.get('Rule Name', '')),
                "policy": clean_string(row.get('Natural Language Rule / Policy', '')),
                "rule_type": clean_string(row.get('Rule Type', '')),
                "input_properties": clean_string(row.get('Input Properties / Objects', '')),
                "output": clean_string(row.get('Decision Output', '')),
                "engine": clean_string(row.get('Engine / Capability', '')),
                "severity": clean_string(row.get('Severity', 'Medium')),
                "message": clean_string(row.get('User/System Message', ''))
            }
            
            for s in scopes:
                if s == "Claim/FNOL":
                    for target_obj in ["Claim", "FNOL"]:
                        if target_obj in object_by_id:
                            object_by_id[target_obj]['policies'].append(policy_data)
                elif s in object_by_id:
                    object_by_id[s]['policies'].append(policy_data)

    # 5. Extract Actions/Events from 05_ActionEvent
    if not df_actions.empty:
        for _, row in df_actions.iterrows():
            scope_str = clean_string(row.get('Object Scope', ''))
            if not scope_str:
                continue
            scopes = [s.strip() for s in re.split(r'[;,]', scope_str) if s.strip()]
            
            action_data = {
                "action_name": clean_string(row.get('Action Name', '')),
                "actor": clean_string(row.get('Actor/System', '')),
                "current_state": clean_string(row.get('Current State', '')),
                "event_name": clean_string(row.get('Business Event', '')),
                "event_vietnamese": clean_string(row.get('Event Name tiếng Việt', '')),
                "next_state": clean_string(row.get('Result / Next State', '')),
                "engine": clean_string(row.get('Engine / Capability', ''))
            }
            
            for s in scopes:
                if s == "Claim/FNOL":
                    for target_obj in ["Claim", "FNOL"]:
                        if target_obj in object_by_id:
                            object_by_id[target_obj]['actions'].append(action_data)
                elif s in object_by_id:
                    object_by_id[s]['actions'].append(action_data)

    # 6. Extract Relationships from 03_ObjectRelationship
    relationships = []
    for _, row in df_rels.iterrows():
        source = clean_string(row['Source Object'])
        target = clean_string(row['Target Object'])
        if not source or not target:
            continue
            
        rel_type = clean_string(row.get('Relationship Type / Link Name', ''))
        cardinality = clean_string(row.get('Cardinality', '1 -> N'))
        ownership = clean_string(row.get('Ownership Type', ''))
        mandatory = clean_string(row.get('Mandatory?', 'No')) in ['Yes', 'Y']
        tech_mapping = clean_string(row.get('Technical Mapping', ''))
        meaning = clean_string(row.get('Business Meaning', ''))
        
        rel_data = {
            "source": source,
            "target": target,
            "type": rel_type,
            "cardinality": cardinality,
            "ownership": ownership,
            "mandatory": mandatory,
            "technical_mapping": tech_mapping,
            "meaning": meaning
        }
        
        # Resolve Claim/FNOL
        resolved_rels = []
        if source == "Claim/FNOL":
            resolved_rels.append({**rel_data, "source": "Claim"})
            resolved_rels.append({**rel_data, "source": "FNOL"})
        elif target == "Claim/FNOL":
            resolved_rels.append({**rel_data, "target": "Claim"})
            resolved_rels.append({**rel_data, "target": "FNOL"})
        else:
            resolved_rels.append(rel_data)
            
        for r in resolved_rels:
            # Let's verify if source and target actually exist in our objects list.
            # If not, print a warning but keep it, or we can check.
            relationships.append(r)
            
            # Label FK in property lists
            # For example, if technical mapping mentions "FK product.partner_id", we can mark "partner_id" of "product" as FK
            # Or if target is Partner, source is Product, product's partner_code or partner_id is FK.
            # Let's do a simple check: if target has an Identifier property, and source has a property of name "target_name_id" or "target_name_code", we can mark it as is_fk.
            # Let's also look at the technical_mapping string.
            m_fk = re.search(r'FK\s+(\w+)\.(\w+)', r['technical_mapping'], re.IGNORECASE)
            if m_fk:
                tbl_name = m_fk.group(1).lower()
                col_name = m_fk.group(2).lower()
                # Find source/target object matching tbl_name
                for obj_id, obj in object_by_id.items():
                    if obj_id.lower() == tbl_name:
                        for prop in obj['properties']:
                            if prop['name'].lower() == col_name or prop['erd_mapping'].lower() == col_name:
                                prop['is_fk'] = True
                                prop['fk_target'] = r['target'] if obj_id == r['source'] else r['source']

    # Also automatically flag properties that end with _id, _code, _key and are not PKs as FKs if they reference another object name.
    object_names_lower = {obj_name.lower(): obj_name for obj_name in object_by_id.keys()}
    for obj_id, obj in object_by_id.items():
        for prop in obj['properties']:
            pname = prop['name'].lower()
            if not prop['is_pk'] and not prop['is_fk']:
                # check if it ends with _id or _code or _key
                for suffix in ['_id', '_code', '_key', 'id', 'code']:
                    if pname.endswith(suffix):
                        prefix = pname[:-len(suffix)].rstrip('_')
                        if prefix in object_names_lower:
                            prop['is_fk'] = True
                            prop['fk_target'] = object_names_lower[prefix]
                            break

    # Save output
    output_data = {
        "domains": domains,
        "objects": list(object_by_id.values()),
        "relationships": relationships
    }
    
    os.makedirs("output", exist_ok=True)
    os.makedirs("web", exist_ok=True)
    
    with open("output/ontology.json", "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    with open("web/ontology.json", "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    with open("web/ontology-data.js", "w", encoding="utf-8") as f:
        f.write(f"window.ONTOLOGY_DATA = {json.dumps(output_data, ensure_ascii=False, indent=2)};")
        
    print(f"Successfully exported data to ontology.json and ontology-data.js!")
    print(f"Domains count: {len(domains)}")
    print(f"Objects count: {len(output_data['objects'])}")
    print(f"Relationships count: {len(relationships)}")

if __name__ == "__main__":
    parse_excel()
