/** Registered photos permit deletion, not user metadata edits.
 * Compatibility facade only: even enabled:true cannot create transport, inspect
 * credentials/session/payload, retry an old correction or reactivate candidate017.
 * The original implementation and tests are preserved in the policy artifact.
 */
export function createPrivatePhotoMetadataClient() {
  let disposed=false;
  const denied=Object.freeze({ok:false,confirmed:false,code:'POLICY_UNCONFIGURED',uncertain:false});
  const operations=Object.freeze([]);
  const refuse=async()=>denied;
  return Object.freeze({
    save:refuse,retry:refuse,recheck:refuse,
    getState:()=>Object.freeze({configured:false,authenticated:false,disposed,pending:0,operations}),
    subscribe:()=>()=>{},
    dispose(){disposed=true;},
  });
}
