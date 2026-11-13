#!/usr/bin/env python3
"""Offline audit of the exact public portfolio file set; not a security warranty."""
from pathlib import Path
import json,re,hashlib
root=Path(__file__).resolve().parents[1]
allowed=json.loads((root/'FILE_ALLOWLIST.json').read_text())['files']
paths=[p for p in root.rglob('*') if '.git' not in p.relative_to(root).parts]
actual=sorted(p.relative_to(root).as_posix() for p in paths if p.is_file())
findings=[];edges=[];literal_imports=0
if actual!=sorted(allowed):findings.append('file allowlist mismatch')
if any(p.is_symlink() for p in paths):findings.append('symlink in export')
hosts={'docs.github.com','www.kats.go.kr','sizekorea.kr','public.invalid','global.canon','www.cipa.jp','portfolio-demo-disabled.supabase.co','PROJECT.supabase.co','127.0.0.1:8897','github.com','si-planet.github.io'}
real_identity=re.compile(r'musicalseeya:theater:|et-theatre|jeongdong|tom2|artone[23]|이티씨어터|GS아트센터|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',re.I)
for name in actual:
 p=root/name
 if name in {'assets/synthetic-seat-view.png': 'f5fcd2b5057d85b8e8b9fd1c5b9cc5b1af47ec058d656706136eccd8e3967877', 'assets/synthetic-photo-projection.jpg': '37567506478b75b9a730f9dd78b57acd88dfdfa2c3bbee75aeb0fab106d07d97', 'assets/synthetic-photo-mobile.jpg': '27ef57104238112ebe471a183a1395162569c15ee8a823bbc52e7291c7114de9'}:
  expected={'assets/synthetic-seat-view.png': 'f5fcd2b5057d85b8e8b9fd1c5b9cc5b1af47ec058d656706136eccd8e3967877', 'assets/synthetic-photo-projection.jpg': '37567506478b75b9a730f9dd78b57acd88dfdfa2c3bbee75aeb0fab106d07d97', 'assets/synthetic-photo-mobile.jpg': '27ef57104238112ebe471a183a1395162569c15ee8a823bbc52e7291c7114de9'}
  if hashlib.sha256(p.read_bytes()).hexdigest()!=expected[name]:findings.append(name+': screenshot differs from reviewed synthetic image')
  continue
 if name.startswith(('.env','node_modules/','supabase/')):findings.append(name+': excluded path')
 if p.suffix not in {'.html','.css','.js','.mjs','.py','.md','.json'} and name not in {'LICENSE','.nojekyll','.gitignore'}:findings.append(name+': unreviewed file type')
 try:content=p.read_text()
 except UnicodeDecodeError:findings.append(name+': non-text payload');continue
 if re.search(r'/(?:Users|home)/[^/]+/|[\w.+-]+@(?:gmail|naver|outlook)\.com|sb_secret_[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----',content):findings.append(name+': private marker')
 if name.startswith(('src/','data/')) and real_identity.search(content):findings.append(name+': real venue identity')
 for host in re.findall(r'https?://([A-Za-z0-9._:-]+)',content):
  if host not in hosts:findings.append(name+': unreviewed literal URL host')
 if p.suffix in ('.js','.mjs'):
  specs=re.findall(r'(?:\bfrom\s+|^\s*import\s*|\bimport\s*\(\s*)[\'\"]([^\'\"]+)[\'\"]',content,re.M)
  for spec in specs:
   literal_imports+=1
   if spec.startswith('node:') and name.startswith('tests/'):continue
   if not spec.startswith('.'):findings.append(name+': nonlocal module');continue
   q=(p.parent/spec).resolve()
   if not q.is_relative_to(root) or not q.is_file():findings.append(name+': missing/outside local module')
   else:edges.append([name,q.relative_to(root).as_posix()])
  for resource in re.findall(r'[\'\"](\./data/[^\'\"]+\.json)[\'\"]',content):
   if not (root/resource).is_file():findings.append(name+': missing runtime JSON')
for name in ['private-hosted-settings','public-post-settings','public-seat-photo-settings']:
 if not re.search(r'enabled\s*:\s*false',(root/'src'/f'{name}.js').read_text()):findings.append(name+': setting not disabled')
if '\"mode\":\"none\"' not in (root/'src/public-catalog-settings.js').read_text():findings.append('public catalog setting not none')
html=(root/'index.html').read_text()
for directive in ["connect-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]:
 if directive not in html:findings.append('missing CSP: '+directive)
for ref in re.findall(r'(?:src|href)=[\'\"]([^\'\"]+)',html):
 if ref.startswith(('#','blob:','data:')):continue
 if not ref.startswith('./') or not (root/ref).exists():findings.append('nonrelative/missing HTML asset')
app=(root/'src/app.js').read_text()
if any(x in app for x in ['createPrivatePhotoImportControls','photoImportEnabled','photoImportPlanDigest','setupLocalRegistration','legacyCatalogConnectionConfig']):findings.append('disabled service composition remains')
if "code:'HOSTED_DISABLED_IN_PORTFOLIO'" not in app:findings.append('hosted connection guard missing')
if 'const isAdmin=()=>false;' not in (root/'src/private-hosted-controls.js').read_text():findings.append('admin route not disabled')
for name in ['synthetic-venue.json','synthetic-model.json']:
 d=json.loads((root/'data/demo'/name).read_text())
 if d.get('synthetic') is not True or d.get('provenance',{}).get('realVenueCoordinateReuse') is not False:findings.append(name+': fixture provenance')
registry=json.loads((root/'data/catalog/theater-model-registry.json').read_text())
if len(registry['entries'])!=1 or not registry['entries'][0]['venueId'].startswith('synthetic-'):findings.append('model registry is not one synthetic venue')
for name in ['theater-seat-plan-registry.json','theater-historical-seat-plan-registry.json','theater-structure-registry.json']:
 if json.loads((root/'data/catalog'/name).read_text()).get('entries')!=[]:findings.append(name+': unexpected real-data entries')
records=json.loads((root/'data/catalog/portfolio-venue-information.json').read_text())['records']
if len(records)!=2 or records[1].get('portfolioDisabled') is not True:findings.append('generic unavailable theatre entry missing')
result={'ok':not findings,'files':len(actual),'literalModuleImports':literal_imports,'resolvedLocalModuleEdges':len(edges),'gitMetadataPresent':(root/'.git').exists(),'findings':findings,'scope':'Static source/data audit only. Git history is not inspected; no network or browser execution.'}
print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(bool(findings))
