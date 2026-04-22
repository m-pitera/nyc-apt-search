import {
  AVAILABILITY_VALUES,
  WORKFLOW_STATUS_VALUES,
  insertListingSchema,
  updateListingSchema,
} from "../shared/schema";

let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok  ${message}`);
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

assert(
  AVAILABILITY_VALUES.includes("active") &&
    AVAILABILITY_VALUES.includes("inactive") &&
    AVAILABILITY_VALUES.includes("stale"),
  "availability values include active, inactive, stale",
);

const workflowRequired = ["new", "contacted", "scheduled", "applied", "signed", "rejected"] as const;
for (const value of workflowRequired) {
  assert(
    (WORKFLOW_STATUS_VALUES as readonly string[]).includes(value),
    `workflow status includes "${value}"`,
  );
}

const defaults = insertListingSchema.parse({ link: "https://streeteasy.com/rental/1" });
assert(defaults.availability === "active", "insert default availability is active");
assert(defaults.workflowStatus === "new", "insert default workflow status is new");

const invalidAvailability = updateListingSchema.safeParse({ availability: "bogus" });
assert(!invalidAvailability.success, "unknown availability value is rejected");

const invalidWorkflow = updateListingSchema.safeParse({ workflowStatus: "onboarding" });
assert(!invalidWorkflow.success, "unknown workflow status is rejected");

const validUpdate = updateListingSchema.safeParse({
  availability: "inactive",
  workflowStatus: "applied",
});
assert(validUpdate.success, "valid availability + workflowStatus update parses");

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll tests passed`);
