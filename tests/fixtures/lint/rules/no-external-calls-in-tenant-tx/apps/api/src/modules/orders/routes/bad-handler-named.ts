declare function defineRoute(spec: object): unknown;

// D-ARCH-106 R3: `handler: name` resolved in the same file, a function declaration and a const arrow.
async function cancel(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const archive = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

export const cancelRoute = defineRoute({ operationId: 'cancelOrder', handler: cancel });
export const archiveRoute = defineRoute({ operationId: 'archiveOrder', handler: archive });
