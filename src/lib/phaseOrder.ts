/**
 * 新增一個階段時,它在階段順序裡該排第幾個:照時間,插在第一個「開始日比它晚」的階段前面,
 * 沒有就排最後。existing 是目前的階段順序(各表共用的那一組)。
 * 這樣在人力表加一個起訖落在 EVT1 與 DVT 之間的 EVT2,樣機計畫等表格的欄位就會是 EVT1、EVT2、DVT,
 * 而不是把新階段丟到最右邊。
 */
export function chronologicalInsertIndex(existing: { startDate: string }[], startDate: string): number {
  const index = existing.findIndex((p) => p.startDate > startDate);
  return index < 0 ? existing.length : index;
}
