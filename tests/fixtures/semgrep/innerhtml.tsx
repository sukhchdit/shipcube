// Semgrep test fixture for .semgrep/innerhtml.yml (REQ-SEC-016, PR2-SEC-04 sink list). Never executed.
export function sinks(el: HTMLElement, frame: HTMLIFrameElement, html: string): unknown[] {
  // ruleid: platform.innerhtml.html-sink
  el.innerHTML = html;
  // ruleid: platform.innerhtml.html-sink
  el.outerHTML = html;
  // ruleid: platform.innerhtml.html-sink
  el['innerHTML'] = html;
  // ruleid: platform.innerhtml.html-sink
  el.insertAdjacentHTML('beforeend', html);
  // ruleid: platform.innerhtml.html-sink
  frame.srcdoc = html;
  // ruleid: platform.innerhtml.html-sink
  const fragment = document.createRange().createContextualFragment(html);
  // ruleid: platform.innerhtml.html-sink
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  // ruleid: platform.innerhtml.html-sink
  el.setHTMLUnsafe(html);
  // ruleid: platform.innerhtml.html-sink
  const unsafeDoc = Document.parseHTMLUnsafe(html);
  // ruleid: platform.innerhtml.html-sink
  Object.assign(el, { id: 'x', innerHTML: html });
  // ruleid: platform.innerhtml.html-sink
  document.write(html);
  // ruleid: platform.innerhtml.html-sink
  window.document.write(html);
  // ruleid: platform.innerhtml.html-sink
  const props = { dangerouslySetInnerHTML: { __html: html } };
  // ok: platform.innerhtml.html-sink
  el.textContent = html;
  // ok: platform.innerhtml.html-sink
  Object.assign(el, { id: 'x', title: html });
  return [fragment, parsed, unsafeDoc, props];
}

export function Component({ html }: { html: string }): unknown {
  // ruleid: platform.innerhtml.html-sink
  const injected = <div className="x" dangerouslySetInnerHTML={{ __html: html }} />;
  // ruleid: platform.innerhtml.html-sink
  const frame = <iframe title="preview" srcDoc={html} />;
  // ok: platform.innerhtml.html-sink
  const encoded = <p className="x">{html}</p>;
  return (
    <section>
      {injected}
      {frame}
      {encoded}
    </section>
  );
}
