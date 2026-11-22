export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  court: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h18M3 8h18M3 16h18"/>',
  trophy: '<path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3h8m-6-3h4"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-8l1-8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM10 2h4l1 3 3 1 3 2-1 4 1 4-3 2-3 1-1 3h-4l-1-3-3-1-3-2 1-4-1-4 3-2 3-1 1-3Z"/>',
  qr: '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zm4 0h2v6h-4v-2h-2m-3-7v3m0 4v3M3 12h6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  undo: '<path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  play: '<path d="m7 3 14 9-14 9V3Z"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/>',
  logout: '<path d="M9 3H4v18h5m6-14 5 5-5 5m-7-5h12"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6"/>',
  ball: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="8" r="1"/><circle cx="16" cy="9" r="1"/><circle cx="13" cy="15" r="1"/><circle cx="6" cy="14" r="1"/>'
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.court}</svg>`;
export const initials = name => escapeHTML(String(name).split(/\s+/).slice(0, 2).map(n => n[0]).join(''));
export const button = (label, action, attrs = '', style = '') => `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
export function picker(name, label, items, selected = '', hint = '') {
  const options = items.map(item => typeof item === 'string' ? { value: item, label: item } : item);
  const chosen = options.find(i => String(i.value) === String(selected)) || options[0];
  const id = `pick-${name}`;
  return `<div class="field"><label id="${id}-label">${escapeHTML(label)}</label><div class="picker"><input type="hidden" name="${name}" value="${escapeHTML(chosen?.value ?? '')}"><button class="picker-trigger" type="button" aria-labelledby="${id}-label ${id}-value" aria-haspopup="listbox" aria-expanded="false"><span id="${id}-value">${escapeHTML(chosen?.label ?? 'Choose…')}</span>${icon('chevron')}</button><div class="picker-list" role="listbox" aria-labelledby="${id}-label" hidden>${options.map(i => `<button type="button" role="option" tabindex="-1" aria-selected="${String(i.value) === String(chosen?.value)}" data-value="${escapeHTML(i.value)}">${escapeHTML(i.label)}</button>`).join('')}</div></div>${hint ? `<small>${escapeHTML(hint)}</small>` : ''}</div>`;
}
export function field(name, label, type = 'text', value = '', extra = '') {
  return `<div class="field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${extra}></div>`;
}
export function stepper(name, label, value, min = 0, max = 99) {
  return `<div class="field"><label for="field-${name}">${escapeHTML(label)}</label><div class="stepper"><button type="button" data-step="-1" aria-label="Decrease ${escapeHTML(label)}">−</button><input name="${name}" id="field-${name}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${value}"><button type="button" data-step="1" aria-label="Increase ${escapeHTML(label)}">+</button></div></div>`;
}
export function formatDate(value, includeTime = true) { return value ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(value)) : 'Not scheduled'; }
export function contrastText(hex) {
  const rgb = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  const l = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return (l + .05) / .05 >= 1.05 / (l + .05) ? '#000000' : '#ffffff';
}
export function setupComponents(root = document) {
  root.addEventListener('click', event => {
    const trigger = event.target.closest('.picker-trigger');
    if (trigger) {
      const list = trigger.nextElementSibling, wasOpen = !list.hidden;
      root.querySelectorAll('.picker-list').forEach(l => { l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false'); });
      list.hidden = wasOpen; trigger.setAttribute('aria-expanded', String(!wasOpen));
      if (!wasOpen) list.querySelector('[aria-selected="true"]')?.focus(); return;
    }
    const option = event.target.closest('[role="option"]');
    if (option) {
      const pick = option.closest('.picker'); pick.querySelector('input').value = option.dataset.value;
      pick.querySelector('.picker-trigger span').textContent = option.textContent;
      pick.querySelectorAll('[role="option"]').forEach(o => o.setAttribute('aria-selected', String(o === option)));
      option.parentElement.hidden = true; const btn = pick.querySelector('.picker-trigger'); btn.setAttribute('aria-expanded', 'false'); btn.focus();
      pick.querySelector('input').dispatchEvent(new Event('change', { bubbles: true })); return;
    }
    const step = event.target.closest('[data-step]');
    if (step) { const input = step.parentElement.querySelector('input'); const n = Number(input.value) + Number(step.dataset.step); input.value = Math.min(Number(input.max), Math.max(Number(input.min), n)); input.dispatchEvent(new Event('input', { bubbles: true })); }
    if (!event.target.closest('.picker')) root.querySelectorAll('.picker-list').forEach(l => { l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false'); });
  });
  root.addEventListener('keydown', event => {
    const pick = event.target.closest('.picker'); if (!pick) return;
    const list = pick.querySelector('.picker-list'), opts = [...list.children], idx = opts.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); list.hidden = false; pick.querySelector('.picker-trigger').setAttribute('aria-expanded', 'true');
      opts[event.key === 'Home' ? 0 : event.key === 'End' ? opts.length - 1 : (idx + (event.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
    }
    if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); list.hidden = true; pick.querySelector('.picker-trigger').setAttribute('aria-expanded', 'false'); pick.querySelector('.picker-trigger').focus(); }
  });
}

const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
class DateRange extends HTMLElement {
  connectedCallback() {
    this.month = new Date(); this.month.setDate(1); this.start = ''; this.end = ''; this.selecting = 'start'; this.render();
    this.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.month) { this.month.setMonth(this.month.getMonth() + Number(b.dataset.month)); this.renderCalendar(); }
      if (b.dataset.day) this.choose(b.dataset.day);
      if (b.dataset.dateAction === 'today') this.choose(dateKey(new Date()));
      if (b.dataset.dateAction === 'clear') { this.start = ''; this.end = ''; this.selecting = 'start'; this.update(); }
      if (b.dataset.select) { this.selecting = b.dataset.select; this.update(); }
      if (b.dataset.quick) { const [h, m, ap] = b.dataset.quick.split(':'); this.querySelector('[name="hour"]').value = h; this.querySelector('[name="minute"]').value = m; this.querySelector('[name="ampm"]').value = ap; this.querySelector('.time-ampm').textContent = ap; }
      if (b.classList.contains('time-ampm')) { const input = this.querySelector('[name="ampm"]'); input.value = input.value === 'AM' ? 'PM' : 'AM'; b.textContent = input.value; }
      if (b.dataset.dateAction === 'set-time') this.updateTime();
    });
    this.addEventListener('keydown', e => {
      if (!e.target.dataset.day) return;
      const d = new Date(e.target.dataset.day + 'T12:00:00');
      const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7, Home: -d.getDay(), End: 6 - d.getDay() };
      if (e.key in moves) d.setDate(d.getDate() + moves[e.key]);
      else if (e.key === 'PageDown' || e.key === 'PageUp') d.setMonth(d.getMonth() + (e.key === 'PageDown' ? 1 : -1)); else return;
      e.preventDefault(); this.month = new Date(d.getFullYear(), d.getMonth(), 1); this.renderCalendar(); this.querySelector(`[data-day="${dateKey(d)}"]`)?.focus();
    });
  }
  choose(day) { if (this.selecting === 'start') { this.start = day; this.selecting = 'end'; } else { this.end = day; this.selecting = 'start'; } this.update(); }
  render() {
    this.innerHTML = `<div class="date-values"><button type="button" data-select="start"></button><button type="button" data-select="end"></button></div><div class="calendar"></div><div class="row">${button('Today', '', 'data-date-action="today"', 'small quiet')}${button('Clear', '', 'data-date-action="clear"', 'small quiet')}<span class="muted">Philippine time</span></div><details><summary>Set start or end time</summary><div class="time-picker">${stepper('hour','Hour',8,1,12)}${stepper('minute','Minute',0,0,59)}<div class="field"><label>Period</label><input type="hidden" name="ampm" value="AM"><button type="button" class="btn time-ampm">AM</button></div></div><div class="row">${['8:00:AM','12:00:PM','5:00:PM'].map(t=>button(t.replace(/:(AM|PM)/,' $1'),' ',`data-quick="${t}"`,'small')).join('')}</div><p class="muted">Select Start or End above, then apply the time.</p>${button('Apply time','','data-date-action="set-time"','small')}</details><input type="hidden" name="start"><input type="hidden" name="end"><p class="date-error error" role="status"></p>`;
    this.update();
  }
  updateTime() {
    const key = this.selecting, date = this[key]; if (!date) { this.querySelector('.date-error').textContent = 'Choose a date first.'; return; }
    const h = Number(this.querySelector('[name="hour"]').value), m = Number(this.querySelector('[name="minute"]').value);
    if (!Number.isInteger(h) || h < 1 || h > 12 || !Number.isInteger(m) || m < 0 || m > 59) { this.querySelector('.date-error').textContent = 'Use hours 1–12 and minutes 0–59.'; return; }
    this[key + 'Time'] = `${String(h % 12 + (this.querySelector('[name="ampm"]').value === 'PM' ? 12 : 0)).padStart(2,'0')}:${String(m).padStart(2,'0')}`; this.update();
  }
  update() {
    for (const key of ['start','end']) {
      const value = this[key] ? `${this[key]}T${this[key + 'Time'] || '08:00'}:00+08:00` : '';
      this.querySelector(`[name="${key}"]`).value = value;
      const b = this.querySelector(`[data-select="${key}"]`); b.textContent = `${key === 'start' ? 'Start' : 'End'}: ${value ? formatDate(value) : 'Optional'}`; b.classList.toggle('selected', this.selecting === key);
    }
    this.querySelector('.date-error').textContent = this.start && this.end && new Date(this.querySelector('[name="end"]').value) < new Date(this.querySelector('[name="start"]').value) ? 'End must be on or after start.' : '';
    this.renderCalendar();
  }
  renderCalendar() {
    const y = this.month.getFullYear(), m = this.month.getMonth(), count = new Date(y,m+1,0).getDate(), offset = new Date(y,m,1).getDay();
    this.querySelector('.calendar').innerHTML = `<div class="calendar-head"><button type="button" data-month="-1" aria-label="Previous month">‹</button><strong aria-live="polite">${this.month.toLocaleDateString('en',{month:'long',year:'numeric'})}</strong><button type="button" data-month="1" aria-label="Next month">›</button></div><div class="calendar-grid" role="group" aria-label="Choose date; use arrow keys or Page Up and Page Down">${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<span>${d}</span>`).join('')}${'<span></span>'.repeat(offset)}${Array.from({length:count},(_,i)=>{const key=dateKey(new Date(y,m,i+1)), selected=[this.start,this.end].includes(key); return `<button type="button" data-day="${key}" class="${selected?'selected':''} ${key>this.start&&this.end&&key<this.end?'in-range':''}" aria-label="${new Date(y,m,i+1).toLocaleDateString('en',{dateStyle:'full'})}" aria-pressed="${selected}" ${key===dateKey(new Date())?'aria-current="date"':''}>${i+1}</button>`;}).join('')}</div>`;
  }
}
customElements.define('date-range', DateRange);

export function hsvHex(h, s, v) {
  s /= 100; v /= 100; const c = v * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return '#' + rgb.map(n => Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
}
class AccentPicker extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<div class="color-presets">${[['Match lime','#d5f36b'],['Sky blue','#9ad5f9'],['Sunset','#ffb181'],['Lavender','#cbb9f2']].map(([n,c])=>`<button type="button" data-color="${c}" style="--swatch:${c}"><i></i>${n}</button>`).join('')}</div><div class="color-preview">Your next great game <span class="btn">Call next</span></div><div class="spectrum" role="img" aria-label="Color saturation and brightness spectrum. Use the labeled sliders below for keyboard control."><span></span></div><label>Hue<input class="hue" type="range" name="hue" min="0" max="359" value="73"></label><label>Saturation<input type="range" name="saturation" min="0" max="100" value="56"></label><label>Brightness<input type="range" name="brightness" min="0" max="100" value="95"></label>${field('accent','Hex color','text',this.getAttribute('value') || '#d5f36b','pattern="#[0-9a-fA-F]{6}" required')}`;
    this.fromHex(this.getAttribute('value') || '#d5f36b');
    this.addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(b)this.fromHex(b.dataset.color);});
    this.addEventListener('input',e=> { if(e.target.name==='accent') { if(/^#[0-9a-f]{6}$/i.test(e.target.value)) this.fromHex(e.target.value); } else this.paint(); });
    const spectrum=this.querySelector('.spectrum');
    const move=e=>{const r=spectrum.getBoundingClientRect();this.querySelector('[name="saturation"]').value=Math.round(Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)));this.querySelector('[name="brightness"]').value=Math.round(Math.max(0,Math.min(100,100-(e.clientY-r.top)/r.height*100)));this.paint();};
    spectrum.addEventListener('pointerdown',e=>{spectrum.setPointerCapture(e.pointerId);move(e);});
    spectrum.addEventListener('pointermove',e=>{if(spectrum.hasPointerCapture(e.pointerId))move(e);});
  }
  fromHex(hex) {
    const [r,g,b]=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255), max=Math.max(r,g,b), min=Math.min(r,g,b),d=max-min;
    let h=d===0?0:max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);if(h<0)h+=360;
    this.querySelector('[name="hue"]').value=h;this.querySelector('[name="saturation"]').value=max?d/max*100:0;this.querySelector('[name="brightness"]').value=max*100;this.paint(hex);
  }
  paint(exact) {
    const h=Number(this.querySelector('[name="hue"]').value),s=Number(this.querySelector('[name="saturation"]').value),v=Number(this.querySelector('[name="brightness"]').value),hex=exact||hsvHex(h,s,v);
    this.querySelector('[name="accent"]').value=hex;const el=this.querySelector('.spectrum');el.style.backgroundColor=`hsl(${h} 100% 50%)`;el.firstElementChild.style.left=`${s}%`;el.firstElementChild.style.top=`${100-v}%`;
    this.querySelector('.color-preview .btn').style.background=hex;this.querySelector('.color-preview .btn').style.color=contrastText(hex);
  }
}
customElements.define('accent-picker', AccentPicker);
