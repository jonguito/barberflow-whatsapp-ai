const $ = (s) => document.querySelector(s);
const form = $('#public-booking-form');
const state = { services: [], settings: {}, selectedService: null };
const esc = (v='') => String(v).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=(t)=>parts.find(p=>p.type===t)?.value;return `${get('year')}-${get('month')}-${get('day')}`;
};
const price = (cents) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
const timeOf = (v='') => v.slice(11,16);
async function api(path, options={}) {
  const res=await fetch(path,{...options,headers:{...(options.body?{'content-type':'application/json'}:{}),...options.headers}});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Não foi possível concluir.');return data;
}
async function load() {
  try {
    const [services,barbers,settings]=await Promise.all([api('/api/public/services'),api('/api/public/barbers'),api('/api/public/settings')]);
    state.services=services;state.settings=settings;
    $('#shop-name').textContent=settings.shop_name||'Reserve sua cadeira.';
    $('#shop-tagline').textContent=settings.tagline||'Escolha seu ritual. A gente cuida do resto.';
    $('#shop-address').textContent=`${settings.address||''} · ${settings.opening_note||''}`;
    if(settings.instagram){const link=$('#shop-instagram');link.textContent=`${settings.instagram} ↗`;link.href=`https://instagram.com/${settings.instagram.replace(/^@/,'')}`;}else $('#shop-instagram').remove();
    const featured=services.find(s=>s.name.toLowerCase()==='corte')||services[0];
    $('#service-list').innerHTML=services.map((s,i)=>`<label class="service-choice"><input type="radio" name="serviceId" value="${esc(s.id)}" ${s.id===featured?.id?'checked':''}><span class="service-choice-card"><span class="service-symbol">${i===1?'◒':i===2?'✦':'✂'}</span><span class="service-detail"><strong>${esc(s.name)}</strong><small>${esc(s.duration_min)} min · ${esc(s.description||'')}</small></span><span class="service-price">${esc(price(s.price_cents))}</span></span></label>`).join('');
    $('#barber-select').innerHTML='<option value="">Qualquer profissional disponível</option>'+barbers.map(b=>`<option value="${esc(b.id)}">${esc(b.name)} · ${esc(b.role)}</option>`).join('');
    state.selectedService=featured?.id;
    $('#service-list').addEventListener('change',()=>{state.selectedService=form.elements.serviceId.value;loadSlots();});
    $('#booking-date').addEventListener('change',loadSlots);$('#barber-select').addEventListener('change',loadSlots);
    const firstDate = new Date(`${today()}T12:00:00`);
    for (let offset=0; offset<14; offset+=1) {
      const date=firstDate.toISOString().slice(0,10);
      const qs=new URLSearchParams({date,serviceId:state.selectedService});
      const available=await api(`/api/public/availability?${qs}`);
      if(available.slots.length){$('#booking-date').value=date;break;}
      firstDate.setDate(firstDate.getDate()+1);
    }
    await loadSlots();
  } catch(error) { $('#booking-error').textContent=error.message;$('#service-list').innerHTML='<div class="booking-loading">Não conseguimos carregar os serviços agora.</div>'; }
}
async function loadSlots() {
  const box=$('#slot-list');box.innerHTML='<div class="booking-loading">Consultando vagas…</div>';
  if(!state.selectedService||!$('#booking-date').value){box.innerHTML='<div class="booking-loading">Escolha serviço e data.</div>';return;}
  const qs=new URLSearchParams({serviceId:state.selectedService,date:$('#booking-date').value});if($('#barber-select').value)qs.set('barberId',$('#barber-select').value);
  try {const {slots}=await api(`/api/public/availability?${qs}`);box.innerHTML=slots.length?slots.map((s,i)=>`<label class="slot-choice"><input type="radio" name="startAt" value="${esc(s.startAt)}" data-barber="${esc(s.barberId)}" required ${i===0?'':''}><span>${esc(timeOf(s.startAt))}<small style="display:block;color:#969ea2;font-size:8px;margin-top:3px">${esc(s.barberName)}</small></span></label>`).join(''):'<div class="booking-loading">Sem horários nesse dia. Tente outra data.</div>';}
  catch(error){box.innerHTML=`<div class="booking-loading">${esc(error.message)}</div>`;}
}
form.addEventListener('submit',async(event)=>{
  event.preventDefault();$('#booking-error').textContent='';
  const selected=form.querySelector('input[name="startAt"]:checked');if(!selected){$('#booking-error').textContent='Selecione um horário disponível.';return;}
  const submit=form.querySelector('button[type="submit"],button:not([type])');submit.disabled=true;submit.textContent='Confirmando…';
  try {
    const result=await api('/api/public/bookings',{method:'POST',body:JSON.stringify({name:form.elements.name.value.trim(),phone:form.elements.phone.value,serviceId:state.selectedService,barberId:selected.dataset.barber,startAt:selected.value,consent:form.elements.consent.checked,reminderOptIn:form.elements.reminderOptIn.checked})});
    const confirmation=result.confirmationSent?'Enviamos a confirmação para o WhatsApp informado. Se precisar ajustar, é só responder por lá.':'Sua reserva está registrada. A confirmação automática por WhatsApp será ativada quando a barbearia configurar o canal oficial.';
    form.innerHTML=`<section class="booking-success"><div class="success-icon">✓</div><p class="eyebrow">HORÁRIO RESERVADO</p><h2>Até já, ${esc(result.customer.name.split(' ')[0])}.</h2><p>${esc(result.service.name)} com ${esc(result.barber.name)}<br><strong>${esc(result.start_at.slice(11,16))} · ${esc(result.start_at.slice(8,10))}/${esc(result.start_at.slice(5,7))}/${esc(result.start_at.slice(0,4))}</strong></p><p>${esc(confirmation)}</p><a class="button button-dark" href="/">Voltar ao início</a></section>`;
  } catch(error){$('#booking-error').textContent=error.message;submit.disabled=false;submit.innerHTML='Confirmar horário <span>→</span>';await loadSlots();}
});
load();
