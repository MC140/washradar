#!/usr/bin/env python3
"""Generate WashRadar's $0 GTA address autocomplete index from Ontario ODA."""
import argparse,csv,io,json,re,sys,unicodedata,zipfile
from collections import defaultdict
from pathlib import Path

GTA={"toronto","mississauga","brampton","caledon","oakville","burlington","milton","halton hills","vaughan","richmond hill","markham","aurora","newmarket","east gwillimbury","georgina","king","whitchurch stouffville","pickering","ajax","whitby","oshawa","clarington","uxbridge","scugog","brock"}
SOURCE="Statistics Canada Open Database of Addresses - Ontario"

def norm(v):
 v=unicodedata.normalize("NFD",v or "");v="".join(c for c in v if unicodedata.category(c)!="Mn").lower().replace("-"," ");return re.sub(r"\s+"," ",re.sub(r"[^a-z0-9]+"," ",v)).strip()
def compact(v): return re.sub(r"[^a-z0-9]","",norm(v))
def val(r,*ks):
 for k in ks:
  x=r.get(k.upper(),"")
  if str(x).strip(): return str(x).strip()
 return ""
def postal(v):
 x=re.sub(r"[^A-Za-z0-9]","",v or "").upper();return f"{x[:3]} {x[3:]}" if len(x)==6 else x
def num(v):
 try:return float(v)
 except:return None

def rows(path):
 with zipfile.ZipFile(path) as z:
  files=[i for i in z.infolist() if not i.is_dir() and i.filename.lower().endswith('.csv')]
  if not files: raise RuntimeError('Ontario ODA ZIP contains no CSV')
  matched=False
  for info in files:
   with z.open(info) as raw:
    t=io.TextIOWrapper(raw,encoding='utf-8-sig',errors='replace',newline=''); sample=t.read(8192);t.seek(0)
    try:d=csv.Sniffer().sniff(sample,delimiters=',;\t|')
    except csv.Error:d=csv.excel
    rd=csv.DictReader(t,dialect=d)
    if not rd.fieldnames:continue
    rd.fieldnames=[str(x).strip().upper() for x in rd.fieldnames]; f=set(rd.fieldnames)
    if not {'LATITUDE','LONGITUDE'}<=f or not ({'STREET_NO','FULL_ADDR'}&f):continue
    matched=True;print('Processing',info.filename,flush=True)
    for r in rd:yield {str(k).upper():('' if v is None else str(v)) for k,v in r.items()}
  if not matched:raise RuntimeError('No ODA address CSV with expected coordinate/address fields')

def main():
 p=argparse.ArgumentParser();p.add_argument('--zip',required=True);p.add_argument('--output',default='public/address-index');p.add_argument('--release',default='ODA-ON-v1');p.add_argument('--max-bytes',type=int,default=350*1024*1024);a=p.parse_args()
 out=Path(a.output);chunks_dir=out/'chunks';out.mkdir(parents=True,exist_ok=True);chunks_dir.mkdir(exist_ok=True)
 for x in chunks_dir.glob('*.json'):x.unlink()
 fallback=[];ap=out/'areas.json'
 if ap.exists():
  try:fallback=json.loads(ap.read_text(encoding='utf-8')).get('areas',[])
  except:pass
 chunks=defaultdict(list);seen=set();cities=defaultdict(lambda:[0.,0.,0]);fsas=defaultdict(lambda:[0.,0.,0]);scan=accepted=0
 csv.field_size_limit(min(sys.maxsize,2147483647))
 for r in rows(Path(a.zip)):
  scan+=1
  csd_raw=val(r,'CSDNAME','CSD_NAME','CSD_ENG_NAME');csd=norm(csd_raw)
  if csd not in GTA:continue
  lat=num(val(r,'LATITUDE'));lng=num(val(r,'LONGITUDE'))
  if lat is None or lng is None or not(42.8<=lat<=44.6 and -80.5<=lng<=-78):continue
  civic=val(r,'STREET_NO','CIVIC_NO');street=val(r,'STREET')
  full=val(r,'FULL_ADDR')
  if not civic and full:
   m=re.match(r'^\s*([0-9]+[A-Za-z-]*)\s+(.+)$',full)
   if m:civic,street=m.group(1),street or m.group(2)
  if not street:
   street=' '.join(x for x in [val(r,'STR_NAME_PCS','STR_NAME'),val(r,'STR_TYPE_PCS','STR_TYPE'),val(r,'STR_DIR_PCS','STR_DIR')] if x)
  if not civic or not street:continue
  key=val(r,'ID_GROUP') or '|'.join([csd,norm(civic),norm(street)])
  if key in seen:continue
  seen.add(key);city=val(r,'CITY_PCS','CITY') or csd_raw;pc=postal(val(r,'POSTAL_CODE'));addr=f'{civic} {street}'.strip();sk=norm(' '.join([addr,city,pc]));ck=compact(sk)
  if len(ck)<3:continue
  chunks[ck[:3]].append([sk,f'{addr}, {city}, ON'+(f' {pc}' if pc else ''),round(lat,5),round(lng,5)]);accepted+=1
  ckey=norm(csd_raw or city);cities[ckey][0]+=lat;cities[ckey][1]+=lng;cities[ckey][2]+=1
  pr=re.sub(r'[^A-Za-z0-9]','',pc).upper()
  if len(pr)>=3:fsas[pr[:3]][0]+=lat;fsas[pr[:3]][1]+=lng;fsas[pr[:3]][2]+=1
 if not accepted:raise RuntimeError('No GTA addresses accepted from Ontario ODA')
 total=largest=0
 for k,rs in chunks.items():
  rs.sort(key=lambda x:(x[0],x[1]));s=json.dumps(rs,ensure_ascii=False,separators=(',',':'));(chunks_dir/f'{k}.json').write_text(s,encoding='utf-8');b=len(s.encode());total+=b;largest=max(largest,b)
 areas={norm(str(x[0])):x for x in fallback if isinstance(x,list) and len(x)>=5}
 for k,(la,lo,n) in cities.items():
  if n:areas[k]=[k,(areas[k][1] if k in areas else f'{k.title()}, ON'),round(la/n,5),round(lo/n,5),'city']
 for f,(la,lo,n) in fsas.items():
  if n>=2:areas[norm(f)]=[norm(f),f'{f}, ON',round(la/n,5),round(lo/n,5),'postal']
 ap.write_text(json.dumps({'release':a.release,'source':SOURCE,'areas':sorted(areas.values(),key=lambda x:(x[4],x[0]))},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 m={'available':True,'release':a.release,'source':SOURCE,'addressCount':accepted,'scannedRows':scan,'chunkCount':len(chunks),'jsonBytes':total,'largestChunkBytes':largest,'unitAddressesOmitted':True}
 (out/'manifest.json').write_text(json.dumps(m,indent=2),encoding='utf-8');print(json.dumps(m,indent=2))
 if total>a.max_bytes:raise RuntimeError(f'Address index {total/1048576:.1f} MB exceeds safety ceiling')
if __name__=='__main__':main()
