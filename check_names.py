import pandas as pd

df_obj = pd.read_excel('Ontology_Claims_F88.xlsx', sheet_name='01_DomainObject')
df_rel = pd.read_excel('Ontology_Claims_F88.xlsx', sheet_name='03_ObjectRelationship')

all_objects = set(df_obj['Object Type'].dropna().unique())
rel_sources = set(df_rel['Source Object'].dropna().unique())
rel_targets = set(df_rel['Target Object'].dropna().unique())

print("DomainObject categories:")
print(df_obj['Object Category'].value_counts())

print("\nAll object types in DomainObject sheet:")
print(sorted(list(all_objects)))

print("\nSources not in DomainObject sheet:")
print(rel_sources - all_objects)

print("\nTargets not in DomainObject sheet:")
print(rel_targets - all_objects)
