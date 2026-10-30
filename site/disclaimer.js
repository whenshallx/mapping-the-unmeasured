// Native dialog supplies Escape and focus handling for both visible entrances.
export function bindDisclaimer() {
  const dialog=document.querySelector('#disclaimer-dialog');
  const open=()=>{if(!dialog.open)dialog.showModal();};
  document.querySelectorAll('[data-disclaimer-open]').forEach(button=>button.addEventListener('click',open));
  const openFromLink=()=>{if(location.hash==='#disclaimer')open();};
  window.addEventListener('hashchange',openFromLink);
  openFromLink();
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const box=dialog.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
  });
}
