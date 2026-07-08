import pandas as pd
import json

df_obj = pd.read_excel('Ontology_Claims_F88.xlsx', sheet_name='01_DomainObject')
with open('domain_object_dump.txt', 'w', encoding='utf-8') as f:
    f.write(df_obj.to_string())
