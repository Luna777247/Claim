import pandas as pd
df = pd.read_excel('Ontology_Claims_F88.xlsx', sheet_name='03_ObjectRelationship')
print("Columns:", list(df.columns))
print("Number of relationships:", len(df))
print("First 20 relationships:")
print(df[['Source Object', 'Target Object', 'Relationship Type / Link Name', 'Cardinality']].head(20))
