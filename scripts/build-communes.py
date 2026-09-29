"""Build src/data/communes.json from scripts/algeria_cities.json.

Source: github.com/othmanus/algeria-cities (1541 communes, 58 wilayas, based on
Interior Ministry data). Wilayas 59-69 (law 26-06, 2026) are built from the
communes of their parent wilaya: an exact list where it could be verified,
otherwise every commune of the parent wilaya.
"""
import json, re, unicodedata, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
rows = json.load(open(ROOT / 'scripts' / 'algeria_cities.json', encoding='utf-8'))

def key(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = s.replace("'", '').replace('-', ' ')
    s = re.sub(r'\b(el|ouled|oulad|ain|sidi|ben|bou)\s', lambda m: m.group(1), s)
    return re.sub(r'[^a-z]', '', s)

by_wilaya = {}
for r in rows:
    by_wilaya.setdefault(int(r['wilaya_code']), []).append(r)

NEW = {
    # code: (parent, exact commune list or None when not verified)
    59: (3, None),   # Aflou
    60: (5, None),   # Barika
    61: (7, None),   # El Kantara
    62: (12, ['Bir El Ater', 'El Ogla El Malha', 'Negrine', 'Ferkane']),
    63: (13, None),  # El Aricha
    64: (14, None),  # Ksar Chellala
    65: (17, None),  # Ain Oussera
    66: (17, ['Messaad', 'Sed Rahal', 'Faidh El Botma', 'Guettara', 'Selmana', 'Oum Laadham', 'Deldoul', 'Amourah']),
    67: (26, ['Ksar El Boukhari', 'Ouled Emaaraf', 'Ain Boucif', 'Derrag', 'Bouaiche', 'Kef Lakhdar', 'Chelalet El Adhaoura',
              'Ouled Hellal', 'Tafraout', 'Boghar', 'Sidi Demed', 'Aziz', 'Chabounia', 'Cheniguel', 'Ain Ou Ksir',
              'Oum El Djellil', "M'fatha", 'Boughzoul', 'El Ouinet', 'Ouled Antar', 'Saneg']),
    68: (28, ['Bou Saada', 'Khoubana', 'MCif', 'Ouled Sidi Brahim', 'Sidi Ameur', 'Tamsa', 'Ben Srour', 'Ouled Slimane',
              'El Houamed', 'El Hamel', 'Zarzour', 'Mohamed Boudiaf', 'Benzouh', 'Bir Foda', 'Ain Fares', 'Sidi MHamed',
              'Menaa', 'Ain El Melh', 'Medjedel', 'Slim', 'Ain Rich', 'Oulteme', 'Djebel Messaad']),
    69: (32, ['Labiodh Sidi Cheikh', 'Ain El Orak', 'Arbaouat', 'Boussemghoun', 'Chellala', 'El Bnoud', 'El Mehara']),
}

out = {}
for code, communes in sorted(by_wilaya.items()):
    out[code] = sorted({(c['commune_name'].strip(), c['commune_name_ascii'].strip()) for c in communes}, key=lambda x: x[1])

missing = {}
exact = []
for code, (parent, names) in NEW.items():
    pool = out[parent]
    if not names:
        out[code] = pool
        continue
    idx = {key(fr): (ar, fr) for ar, fr in pool}
    picked, miss = [], []
    for n in names:
        hit = idx.get(key(n))
        if not hit:  # tolerate small spelling differences
            cands = [v for k, v in idx.items() if key(n)[:6] and k.startswith(key(n)[:6])]
            hit = cands[0] if len(cands) == 1 else None
        (picked if hit else miss).append(hit or n)
    if miss:
        missing[code] = miss
        out[code] = pool  # never ship a list with holes
    else:
        out[code] = sorted(set(picked), key=lambda x: x[1])
        exact.append(code)

data = {
    'source': 'github.com/othmanus/algeria-cities (Interior Ministry data); wilayas 59-69 derived from parent wilayas',
    'exact_new_wilayas': exact,
    'communes': {str(k): [[ar, fr] for ar, fr in v] for k, v in sorted(out.items())},
}
(ROOT / 'src' / 'data' / 'communes.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('wilayas', len(out), 'communes (58)', sum(len(by_wilaya[k]) for k in by_wilaya))
print('exact new wilayas', exact, {c: len(out[c]) for c in exact})
print('unmatched', missing)
