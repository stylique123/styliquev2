import { catalogSyncQueue, recommendationsQueue, tryonRenderQueue } from "../app/queue.server";
const now = Date.now();
for (const q of [catalogSyncQueue, recommendationsQueue, tryonRenderQueue]) {
  const counts = await q.getJobCounts("failed","completed","waiting","active");
  const failed = await q.getFailed(0, 4);
  console.log(`\n[${q.name}] failed=${counts.failed} completed=${counts.completed}`);
  for (const j of failed) {
    const ageH = j.timestamp ? Math.round((now - j.timestamp)/3600000) : -1;
    console.log(`  age ${ageH}h | ${(j.failedReason ?? "").slice(0,90)}`);
  }
}
process.exit(0);
