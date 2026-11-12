export const SanitisedHtml = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />;
