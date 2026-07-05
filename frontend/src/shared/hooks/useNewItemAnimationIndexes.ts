import { useState } from "react";

type ItemId = number | string;

interface IdentifiableItem<TId extends ItemId = ItemId> {
  id: TId;
}

interface NewItemAnimationState<TId extends ItemId> {
  itemIds: Set<TId>;
  animationIndexByItemId: Map<TId, number>;
}

function hasSameItemIds<TItem extends IdentifiableItem>(
  items: TItem[],
  itemIds: Set<TItem["id"]>,
): boolean {
  return items.length === itemIds.size && items.every((item) => itemIds.has(item.id));
}

function getItemIds<TItem extends IdentifiableItem>(
  items: TItem[],
): Set<TItem["id"]> {
  return new Set(items.map((item) => item.id));
}

function getNewItemAnimationIndexById<TItem extends IdentifiableItem>(
  items: TItem[],
  previousItemIds: Set<TItem["id"]>,
): Map<TItem["id"], number> {
  const animationIndexByItemId = new Map<TItem["id"], number>();

  items.forEach((item) => {
    if (!previousItemIds.has(item.id)) {
      animationIndexByItemId.set(item.id, animationIndexByItemId.size);
    }
  });

  return animationIndexByItemId;
}

export function useNewItemAnimationIndexes<TItem extends IdentifiableItem>(
  items: TItem[],
): Map<TItem["id"], number> {
  const [animationState, setAnimationState] = useState<
    NewItemAnimationState<TItem["id"]>
  >(
    () => ({
      itemIds: new Set<TItem["id"]>(),
      animationIndexByItemId: new Map<TItem["id"], number>(),
    }),
  );

  if (!hasSameItemIds(items, animationState.itemIds)) {
    setAnimationState({
      itemIds: getItemIds(items),
      animationIndexByItemId: getNewItemAnimationIndexById(
        items,
        animationState.itemIds,
      ),
    });
  }

  return animationState.animationIndexByItemId;
}
