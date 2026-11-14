// V3: a dynamic import().
export const load = async (): Promise<unknown> => {
  const { auditWriterFromConfig } = await import('../../../platform/audit/writer.js');
  return auditWriterFromConfig({ lockTimeoutMs: 250 });
};
