/** Strict public-wire JSON: duplicate keys and malformed numbers are errors.
 * Public geometry numbers are finite; duplicate/unsafe keys remain rejected.
 * No dependencies, I/O, diagnostics containing values, or implicit coercion.
 */
export function parsePublicCatalogJSON(text) {
  let i=0, nodes=0;
  const bad=()=>{throw new TypeError('INVALID_PUBLIC_JSON');};
  if(typeof text!=='string'||text.length>2*1024*1024)bad();
  const ws=()=>{while(i<text.length&&/[\x20\t\r\n]/.test(text[i]))i++;};
  function string(){
    const start=i++;
    while(i<text.length){
      const ch=text[i++];
      if(ch==='\\'){if(i>=text.length)bad();i++;continue;}
      if(ch==='"'){
        let v;try{v=JSON.parse(text.slice(start,i));}catch{bad();}
        if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))bad();
        return v;
      }
    }
    bad();
  }
  function value(depth){
    if(depth>64||++nodes>100000)bad();ws();const ch=text[i];
    if(ch==='"')return string();
    if(ch==='{'){
      i++;ws();const out=Object.create(null),keys=new Set();
      if(text[i]==='}'){i++;return out;}
      while(true){
        ws();if(text[i]!=='"')bad();const k=string();
        if(keys.has(k)||['__proto__','constructor','prototype'].includes(k))bad();keys.add(k);
        ws();if(text[i++]!==':')bad();out[k]=value(depth+1);ws();
        const end=text[i++];if(end==='}')return out;if(end!==',')bad();
      }
    }
    if(ch==='['){
      i++;ws();const out=[];if(text[i]===']'){i++;return out;}
      while(true){out.push(value(depth+1));ws();const end=text[i++];if(end===']')return out;if(end!==',')bad();}
    }
    for(const [token,v] of [['true',true],['false',false],['null',null]])if(text.startsWith(token,i)){i+=token.length;return v;}
    const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if(!match)bad();i+=match[0].length;
    const number=Number(match[0]);if(!Number.isFinite(number))bad();return number;
  }
  const result=value(0);ws();if(i!==text.length)bad();return result;
}
