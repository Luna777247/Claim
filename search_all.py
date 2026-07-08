import pandas as pd

xl = pd.ExcelFile('Ontology_Claims_F88.xlsx')
for sheet in xl.sheet_names:
    df = pd.read_excel('Ontology_Claims_F88.xlsx', sheet_name=sheet)
    for col in df.columns:
        matches = df[df[col].astype(str).str.contains('Claim/FNOL', na=False)]
        if len(matches) > 0:
            print(f"Sheet: {sheet}, Column: {col}")
            print(matches[[col]].head(2))
