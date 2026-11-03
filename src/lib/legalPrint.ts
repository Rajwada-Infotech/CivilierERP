// Print one ".legal-print" sheet on its own: a copy goes into a bare container at the top of <body> and
// everything else is left out of the print, so the page's layout, sidebars and grid background can't squeeze it.
export function printLegalSheet(root: ParentNode = document) {
  const sheet = root.querySelector(".legal-print");
  if (!sheet) return;
  const box = document.createElement("div");
  box.className = "legal-print-host";
  box.appendChild(sheet.cloneNode(true));
  document.body.appendChild(box);
  document.body.classList.add("legal-printing");
  const done = () => {
    document.body.classList.remove("legal-printing");
    box.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
