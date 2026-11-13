/** Strict private-wire JSON: duplicate keys and numeric type erasure are errors.
 * The canonical contract represents decimals as strings; numbers are safe ints.
 * No dependencies, I/O, diagnostics containing values, or implicit coercion.
 */
export function parsePrivateJSON(text, options = {}) {
  let i=0, nodes=0;
  const bad=()=>{throw new TypeError('INVALID_PRIVATE_JSON');};
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(options))) bad();
  const optionKeys=Reflect.ownKeys(options);
  if(optionKeys.some(k=>k!=='finiteNumberPaths'))bad();
  const descriptor=Object.getOwnPropertyDescriptor(options,'finiteNumberPaths');
  if(descriptor&&(!descriptor.enumerable||!Object.hasOwn(descriptor,'value')))bad();
  const finitePaths=descriptor?.value??[];
  if(!Array.isArray(finitePaths)||finitePaths.length>8||finitePaths.some(p=>!Array.isArray(p)||!p.length||p.length>12
      ||p.some(k=>typeof k!=='string'||!k||k.length>80)))bad();
  const finiteAt=path=>finitePaths.some(p=>path.length>=p.length&&p.every((k,n)=>k==='*'||path[n]===k));
  if(typeof text!=='string'||text.length>4*1024*1024)bad();
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
  function value(depth,path=[]){
    if(depth>64||++nodes>100000)bad();ws();const ch=text[i];
    if(ch==='"')return string();
    if(ch==='{'){
      i++;ws();const out=Object.create(null),keys=new Set();
      if(text[i]==='}'){i++;return out;}
      while(true){
        ws();if(text[i]!=='"')bad();const k=string();
        if(keys.has(k)||['__proto__','constructor','prototype'].includes(k))bad();keys.add(k);
        ws();if(text[i++]!==':')bad();out[k]=value(depth+1,[...path,k]);ws();
        const end=text[i++];if(end==='}')return out;if(end!==',')bad();
      }
    }
    if(ch==='['){
      i++;ws();const out=[];if(text[i]===']'){i++;return out;}
      while(true){out.push(value(depth+1,[...path,String(out.length)]));ws();const end=text[i++];if(end===']')return out;if(end!==',')bad();}
    }
    for(const [token,v] of [['true',true],['false',false],['null',null]])if(text.startsWith(token,i)){i+=token.length;return v;}
    const finite=finiteAt(path);
    const match=(finite?/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/:/^-?(?:0|[1-9][0-9]*)/).exec(text.slice(i));
    if(!match)bad();i+=match[0].length;
    // A following fraction/exponent remains unconsumed and fails its container.
    const number=Number(match[0]);if(finite?!Number.isFinite(number):!Number.isSafeInteger(number))bad();return number;
  }
  const result=value(0);ws();if(i!==text.length)bad();return result;
}
