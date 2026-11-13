import { createCatalogTransport, catalogError, validatePublicCatalogRecord } from './catalog-repository.js';

/** Read-only RPC mapping, no SDK/session/storage/credentials persistence.
 * GET /rest/v1/rpc/theater3d_catalog_read?p_path=...&p_query=<JSON>
 * Delivery uses an independently authorized broker, never raw Storage paths.
 * SQL/RLS/Storage have NOT been executed/verified by this adapter.
 */
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(v)&&!['.','..','__proto__','constructor','prototype'].includes(v);
const allowed={venues:[],names:['venueId'],relations:['venueId'],layouts:['venueId'],seats:['venueId','layoutVersionId','seatId'],works:[],runs:['venueId','layoutVersionId','workId','productionRunId'],photos:['venueId','layoutVersionId','seatId','workId','productionRunId','performanceEventId']};
const kinds={venues:'venue',names:'name',relations:'relation',layouts:'layout',seats:'seat',works:'work',runs:'run',photos:'photo',delivery:'delivery'};
function route(path){
  if(typeof path!=='string')throw catalogError('BAD_REQUEST','Catalog path required');
  let m=/^\/api\/catalog\/(venues|works|runs|photos)$/.exec(path);
  if(m)return{entity:m[1],single:false,filters:allowed[m[1]]};
  m=/^\/api\/catalog\/venues\/([^/]+)\/(names|relations|layouts|seats)$/.exec(path);
  if(m){let venue;try{venue=decodeURIComponent(m[1]);}catch{throw catalogError('BAD_REQUEST','Invalid path encoding');}if(!id(venue))throw catalogError('BAD_REQUEST','Invalid venue ID');return{entity:m[2],venue,single:false,filters:allowed[m[2]]};}
  m=/^\/api\/catalog\/(layouts|photos)\/([^/]+)$/.exec(path);
  if(m){let ident;try{ident=decodeURIComponent(m[2]);}catch{throw catalogError('BAD_REQUEST','Invalid path encoding');}if(!id(ident))throw catalogError('BAD_REQUEST','Invalid record ID');return{entity:m[1],ident,single:true,filters:[]};}
  m=/^\/api\/catalog\/assets\/([^/]+)\/delivery$/.exec(path);
  if(m){let ident;try{ident=decodeURIComponent(m[1]);}catch{throw catalogError('BAD_REQUEST','Invalid path encoding');}if(!id(ident))throw catalogError('BAD_REQUEST','Invalid asset ID');return{entity:'delivery',ident,single:true,filters:[]};}
  throw catalogError('BAD_REQUEST','Unsupported catalog route');
}
function configuration(options){
  const {supabaseUrl,publishableKey,deliveryEndpoint}=options;
  if(!supabaseUrl&&!publishableKey)return{state:'unconfigured',code:'NOT_CONFIGURED'};
  if(typeof supabaseUrl!=='string'||typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(publishableKey))return{state:'invalid',code:'INVALID_CONFIG'};
  try{
    const url=new URL(supabaseUrl);
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&local))throw Error();
    const endpoint=new URL(deliveryEndpoint??'/functions/v1/theater3d-catalog-delivery',url);
    if(endpoint.origin!==url.origin||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/functions/v1/theater3d-catalog-delivery')throw Error();
    return{state:'configured',origin:url.origin,delivery:endpoint.href};
  }catch{return{state:'invalid',code:'INVALID_CONFIG'};}
}
export function createSupabaseCatalogTransport({supabaseUrl,publishableKey,fetchImpl=globalThis.fetch,deliveryEndpoint}={}){
  const config=configuration({supabaseUrl,publishableKey,deliveryEndpoint});
  const state=typeof fetchImpl==='function'?config:{state:'invalid',code:'INVALID_CONFIG'};
  let inner=null;
  if(state.state==='configured'){
    const mapFetch=async(url,options)=>{
      const virtual=new URL(url);const path=virtual.pathname;const selected=route(path);const query=Object.fromEntries(virtual.searchParams.entries());
      let target;
      if(selected.entity==='delivery'){
        target=new URL(state.delivery);target.searchParams.set('assetId',selected.ident);if(query.revision!==undefined)target.searchParams.set('revision',query.revision);
      }else{
        target=new URL('/rest/v1/rpc/theater3d_catalog_read',state.origin);target.searchParams.set('p_path',decodeURIComponent(path));target.searchParams.set('p_query',JSON.stringify(query));
      }
      const response=await fetchImpl(target.href,{...options,headers:{Accept:'application/json',apikey:publishableKey},cache:'no-store'});
      if(!response||typeof response.json!=='function')return response;
      // SQL returns safe envelopes; PostgREST error bodies must never be exposed.
      const wrapped={ok:response.ok,status:response.status,json:async()=>{
        const value=await response.json();
        if(response.ok){
          return value;
        }
        const codes={400:'BAD_REQUEST',404:'NOT_FOUND',409:'REVISION_MISMATCH',401:'SERVICE_UNAVAILABLE',403:'SERVICE_UNAVAILABLE',503:'SERVICE_UNAVAILABLE'};
        const recognized=['BAD_REQUEST','NOT_FOUND','CURSOR_MISMATCH','REVISION_MISMATCH','SERVICE_UNAVAILABLE'];
        const remote=object(value)?(recognized.includes(value.code)?value.code:recognized.includes(value.message)?value.message:null):null;
        return{code:remote??codes[response.status]??'SERVICE_UNAVAILABLE',message:'Catalog service rejected request'};
      }};
      if(response.ok){
        let loaded=false,data;
        const load=async()=>{if(!loaded){data=await wrapped.json();loaded=true;}return data;};
        // RPC failures use SQL exception status codes; normal successes are envelopes.
        return{ok:true,status:response.status,json:load};
      }
      return wrapped;
    };
    inner=createCatalogTransport({baseUrl:state.origin,fetchImpl:mapFetch});
  }
  return Object.freeze({
    getConnectionState:()=>({state:state.state,...(state.code?{code:state.code}:{})}),
    async request(path,{query={},signal}={}){
      if(!inner)throw catalogError(state.code,'Public catalog connection is not configured');
      const selected=route(path);
      if(!object(query))throw catalogError('BAD_REQUEST','Query object required');
      const fields=new Set(['revision',...(selected.single?[]:['limit','cursor']),...selected.filters]);
      for(const [key,value]of Object.entries(query)){
        if(!fields.has(key))throw catalogError('BAD_REQUEST','Unsupported query field');
        if(key==='limit'){if(!Number.isInteger(Number(value))||Number(value)<1||Number(value)>100)throw catalogError('BAD_REQUEST','Limit must be 1–100');}
        else if(key==='cursor'){if(typeof value!=='string'||!value.length||value.length>4096||!/^\S+$/.test(value))throw catalogError('BAD_REQUEST','Invalid cursor');}
        else if(!id(value))throw catalogError('BAD_REQUEST','Invalid query ID');
      }
      if(selected.venue&&query.venueId!==undefined&&query.venueId!==selected.venue)throw catalogError('BAD_REQUEST','Path/query venue mismatch');
      const fixed={...query};if(!selected.single&&fixed.limit===undefined)fixed.limit=25;
      const response=await inner.request(path,{query:fixed,signal});
      const kind=kinds[selected.entity],filters=Object.fromEntries(selected.filters.filter(k=>query[k]!==undefined).map(k=>[k,query[k]]));
      if(selected.venue)filters.venueId=selected.venue;
      if(selected.single){
        if(!object(response.item))throw catalogError('INVALID_RESPONSE','Single item required');
        const item=validatePublicCatalogRecord(kind,response.item,filters);
        if((selected.entity==='delivery'?item.assetId:item.id)!==selected.ident)throw catalogError('INVALID_RESPONSE','Response ID mismatch');
        return{...response,item};
      }
      if(!Array.isArray(response.items)||response.items.length>Number(fixed.limit))throw catalogError('INVALID_RESPONSE','Invalid list page');
      const seen=new Set();const items=response.items.map(v=>{const item=validatePublicCatalogRecord(kind,v,filters);if(seen.has(item.id))throw catalogError('INVALID_RESPONSE','Duplicate public item');seen.add(item.id);return item;});
      if(!items.length&&response.nextCursor!==null)throw catalogError('INVALID_RESPONSE','Empty continuation page');
      return{...response,items};
    },
  });
}
