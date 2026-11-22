import {config} from '../config.js';

// Vercel builds use connected accounts. Explicit exploration stays browser-local.
export function isLiveMode(params, defaultLive=config.defaultLive===true){
  if(params.has('live'))return params.get('live')!=='0';
  if(params.has('explore')||params.has('demo'))return false;
  return defaultLive;
}
