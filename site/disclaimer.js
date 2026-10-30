// A quiet, always-available explanation; native dialog supplies Escape and focus handling.
export function bindDisclaimer() {
  const dialog=document.querySelector('#disclaimer-dialog');
  document.querySelector('#disclaimer-open').addEventListener('click',()=>dialog.showModal());
  dialog.addEventListener('click',event=>{
    if(event.target!==dialog)return;
    const box=dialog.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();
  });
}
