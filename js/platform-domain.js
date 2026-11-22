import { emptyState } from './engine.js';
export const PLATFORM_KEY='jn-platform-v1';
export const SESSION_KEY='jn-prototype-user';
export const clubStorageKey=id=>`jn-club-${id}`;
export const sources=['A friend or teammate','Social media','A club invitation','Search engine','At a pickleball court','Other'];
export const interests=['Find people to play with','Join a club','Run my own club','Explore pickleball'];
export const roleNames={owner:'Club owner',vice:'Vice club owner',member:'Member'};
export function emptyPlatform(){return{version:1,profiles:[],clubs:[],members:[],requests:[],invites:[],passes:[]};}
export function memberRole(db,club,user){return db.members.find(m=>m.club_id===club&&m.user_id===user)?.role||null;}
export function isManager(db,club,user){return['owner','vice'].includes(memberRole(db,club,user));}
export function validLogo(logo){return !logo||(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)&&logo.length<=220000);}
const fail=m=>{throw new Error(m);};
const clean=(value,max)=>String(value||'').trim().slice(0,max);
export function platformAction(previous,actor,action,input={}){
  const db=structuredClone(previous),p=input,now=Date.now(),id=()=>crypto.randomUUID();
  const profile=db.profiles.find(u=>u.id===actor);
  if(!profile)fail('Sign in with a player account first.');
  const club=db.clubs.find(c=>c.id===p.club_id);
  const owner=()=>{if(!club||club.owner_id!==actor)fail('Only this club’s owner can do that.');};
  let result={};
  switch(action){
    case 'purchase-pass':{
      let pass=db.passes.find(x=>x.user_id===actor&&!x.club_id);
      if(!pass){pass={id:id(),user_id:actor,kind:'prototype',amount:0,created_at:now,club_id:null};db.passes.push(pass);}result.pass=pass;break;
    }
    case 'create-club':{
      const pass=db.passes.find(x=>x.id===p.pass_id&&x.user_id===actor&&!x.club_id);if(!pass)fail('Get an unused Club Owner Pass first.');
      const name=clean(p.name,60),tagline=clean(p.tagline,100),count=Number(p.courts);
      if(!name)fail('Give your club a name.');if(!validLogo(p.logo))fail('Use a PNG, JPEG or WebP logo smaller than 160 KB.');
      if(!Number.isInteger(count)||count<1||count>8)fail('Choose 1–8 courts.');
      const c={id:id(),name,tagline,logo:p.logo||'',owner_id:actor,created_at:now};db.clubs.push(c);db.members.push({club_id:c.id,user_id:actor,role:'owner'});pass.club_id=c.id;
      result.club=c;result.state=emptyState();result.state.settings.name=name;result.state.settings.logo=c.logo;result.state.settings.tagline=tagline;result.state.session.title=`${name} · Open Play`;
      result.state.courts=Array.from({length:count},(_,i)=>({id:id(),name:`Court ${i+1}`,status:'available',matchId:null}));break;
    }
    case 'membership-invite':{
      if(!isManager(db,p.club_id,actor))fail('Club management access is required.');
      const invite={id:id(),club_id:p.club_id,token:id()+id(),kind:'membership',expires_at:now+7*86400000,revoked:false};db.invites.push(invite);result.invite=invite;break;
    }
    case 'request-membership':{
      const inv=db.invites.find(i=>i.token===p.token&&i.kind==='membership'&&!i.revoked&&i.expires_at>now);if(!inv)fail('This membership invitation has expired or been revoked.');
      if(memberRole(db,inv.club_id,actor))fail('You are already a member of this club.');
      let request=db.requests.find(r=>r.club_id===inv.club_id&&r.user_id===actor);
      if(request?.status==='pending')fail('Your request is already waiting for owner approval.');
      if(!request){request={id:id(),club_id:inv.club_id,user_id:actor};db.requests.push(request);}Object.assign(request,{status:'pending',note:clean(p.note,200),created_at:now,invite_id:inv.id});result.request=request;break;
    }
    case 'review-request':{
      owner();const request=db.requests.find(r=>r.id===p.request_id&&r.club_id===club.id);if(!request||request.status!=='pending')fail('This request is no longer pending.');
      if(!['accepted','rejected'].includes(p.decision))fail('Choose approve or decline.');request.status=p.decision;request.reviewed_by=actor;
      if(p.decision==='accepted'&&!memberRole(db,club.id,request.user_id))db.members.push({club_id:club.id,user_id:request.user_id,role:'member'});break;
    }
    case 'member-role':{
      owner();if(p.user_id===actor)fail('The owner role cannot be changed here.');if(!['vice','member','remove'].includes(p.role))fail('Invalid member role.');
      const m=db.members.find(m=>m.club_id===club.id&&m.user_id===p.user_id);if(!m)fail('Approve this person as a member first.');
      if(p.role==='remove'){db.members=db.members.filter(x=>x!==m);db.requests.filter(r=>r.club_id===club.id&&r.user_id===p.user_id).forEach(r=>r.status='removed');}else m.role=p.role;break;
    }
    case 'revoke-membership-invites':owner();db.invites.filter(i=>i.club_id===club.id&&i.kind==='membership').forEach(i=>i.revoked=true);break;
    case 'club-brand':owner();if(!clean(p.name,60)||!validLogo(p.logo))fail('Enter a club name and valid image logo.');Object.assign(club,{name:clean(p.name,60),tagline:clean(p.tagline,100),logo:p.logo||''});break;
    default:fail('Unknown platform action.');
  }
  db.version++;return{db,...result};
}
