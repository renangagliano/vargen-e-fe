import assert from "node:assert/strict";
import test from "node:test";
import { buildCoverFilter } from "../src/editorial/cover.js";
import { generateEditorialPackage, validateEditorialBatch, validateEditorialPackage } from "../src/editorial/generator.js";

const outputBase = "C:/pilot/reel.mp4";

function packages() {
  return [
    generateEditorialPackage({ reelId: "reel-1", category: "LYRICAL_HOOK", outputPath: outputBase, rightsStatus: "RIGHTS_PENDING_CONFIRMATION" }),
    generateEditorialPackage({ reelId: "reel-2", category: "MAIN_CHORUS", outputPath: "C:/pilot/reel-02.mp4", rightsStatus: "RIGHTS_PENDING_CONFIRMATION" }),
    generateEditorialPackage({ reelId: "reel-3", category: "STORY_BUILD", outputPath: "C:/pilot/reel-03.mp4", rightsStatus: "RIGHTS_PENDING_CONFIRMATION" }),
  ];
}

test("generates three distinct, safe editorial packages", () => {
  const generated = packages();
  assert.equal(validateEditorialBatch(generated).length, 0);
  assert.equal(new Set(generated.map((item) => item.selected_hook)).size, 3);
  assert.equal(new Set(generated.map((item) => item.cta)).size, 3);
  for (const item of generated) {
    assert.equal(validateEditorialPackage(item).length, 0);
    assert.equal(item.bible_reference, "Êxodo 14");
    assert.ok(item.hashtags.length >= 5 && item.hashtags.length <= 10);
    assert.equal(item.review_status, "READY_FOR_HUMAN_REVIEW");
    assert.equal(item.publication_status, "NOT_PUBLISHED");
  }
});

test("keeps cover text inside configured mobile-safe bounds", () => {
  const filter = buildCoverFilter({ coverText: "Fé para avançar", fontPath: "C:\\Windows\\Fonts\\arial.ttf", safeZoneTopPx: 120, safeZoneBottomPx: 300, safeZoneSidePx: 80 });
  assert.match(filter, /drawbox=x=80:y=1394:w=920:h=150/);
  assert.match(filter, /y=1430/);
  assert.match(filter, /Fé para avançar/);
});
