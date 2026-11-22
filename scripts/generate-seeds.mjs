import { writeFile } from 'node:fs/promises';
import { emptyState } from '../js/engine.js';
import { demoState } from '../js/demo.js';
import { config } from '../config.js';
const empty=emptyState();empty.session.title='Dill Next club session';
await writeFile('supabase/seed.sql', `-- Safe to run again: never overwrites an existing club.\nbegin;\ninsert into public.clubs(id,name) values('${config.clubId}','Dill Next') on conflict do nothing;\ninsert into public.club_state(club_id,payload) values('${config.clubId}', $seed$${JSON.stringify(empty)}$seed$::jsonb) on conflict do nothing;\ncommit;\n`);
const demo=demoState();
await writeFile('supabase/demo-seed.sql', `-- OPTIONAL: seed demo only into an empty club. Refuses if any players exist.\n-- Run as a Supabase SQL administrator. The in-app local demo needs no SQL.\ndo $$\ndeclare existing public.club_state; sample jsonb=$demo$${JSON.stringify(demo)}$demo$::jsonb;\nbegin\nselect * into existing from public.club_state where club_id='${config.clubId}' for update;\nif not found then raise exception 'Run seed.sql first'; end if;\nif jsonb_array_length(existing.payload->'players')>0 then raise exception 'Club already has players; demo import refused'; end if;\nsample=jsonb_set(sample,'{session}',existing.payload->'session');\nupdate public.club_state set payload=sample,version=version+1 where club_id=existing.club_id;\nend $$;\n`);
console.log('Generated empty and optional demo SQL seeds.');
