export type DialogueGraphRow = { dialogId: string; nextDialogIds: string[] };

export type DialogueComponentAnalysis = {
  traversalRoots: string[];
  componentCount: number;
  rootlessComponentCount: number;
  stronglyConnectedComponents: string[][];
  unreachableDialogueIds: string[];
};

const compareIds = (left: string, right: string): number =>
  Number(left) - Number(right) || left.localeCompare(right);

export function analyzeDialogueComponents(
  rows: DialogueGraphRow[],
  declaredRoots: string[] = [],
): DialogueComponentAnalysis {
  const ids = [...new Set(rows.map((row) => row.dialogId))].sort(compareIds);
  const idSet = new Set(ids);
  const adjacency = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const id of ids) {
    adjacency.set(id, []);
    reverse.set(id, []);
  }
  for (const row of rows) {
    for (const next of row.nextDialogIds.filter((id) => idSet.has(id))) {
      adjacency.get(row.dialogId)?.push(next);
      reverse.get(next)?.push(row.dialogId);
    }
  }

  const components: string[][] = [];
  const seen = new Set<string>();
  for (const root of ids) {
    if (seen.has(root)) continue;
    const component: string[] = [];
    const queue = [root];
    seen.add(root);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of [...(adjacency.get(current) ?? []), ...(reverse.get(current) ?? [])]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    components.push(component.sort(compareIds));
  }

  let rootlessComponentCount = 0;
  const traversalRoots = components.flatMap((component) => {
    const declared = declaredRoots.filter((id) => component.includes(id)).sort(compareIds);
    if (declared.length) return declared;
    const natural = component.filter((id) => (reverse.get(id) ?? []).length === 0).sort(compareIds);
    if (natural.length) return natural;
    rootlessComponentCount += 1;
    return component.length ? [component[0]!] : [];
  });

  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const stronglyConnectedComponents: string[][] = [];
  const strongConnect = (id: string): void => {
    indices.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, indices.get(next)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    while (stack.length) {
      const item = stack.pop()!;
      onStack.delete(item);
      component.push(item);
      if (item === id) break;
    }
    const hasSelfLoop =
      component.length === 1 && (adjacency.get(component[0]!) ?? []).includes(component[0]!);
    if (component.length > 1 || hasSelfLoop)
      stronglyConnectedComponents.push(component.sort(compareIds));
  };
  for (const id of ids) if (!indices.has(id)) strongConnect(id);

  const reachable = new Set<string>();
  const queue = [...traversalRoots];
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return {
    traversalRoots,
    componentCount: components.length,
    rootlessComponentCount,
    stronglyConnectedComponents,
    unreachableDialogueIds: ids.filter((id) => !reachable.has(id)),
  };
}
