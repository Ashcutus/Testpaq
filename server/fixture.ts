import { randomUUID } from "node:crypto";
import type { Question, Requirement, Scenario, Testpaq } from "../src/shared/domain.js";

const now = () => new Date().toISOString();

export function makeFixture(stress = false): Testpaq {
  const createdAt = now();
  const requirements: Requirement[] = [
    requirement("Fundraisers can choose to hide the amount raised on campaign pages.", "acceptance_criteria"),
    requirement("The preference persists after the fundraiser signs out and returns.", "acceptance_criteria"),
    requirement("Only campaign owners and administrators can change visibility.", "description"),
    requirement("Existing campaigns remain visible by default after release.", "acceptance_criteria"),
    requirement("The setting must be represented in the campaign API.", "description"),
    requirement("A help article must explain the visibility setting.", "human"),
  ];
  const seeds: Array<[string, Scenario["origin"], Scenario["category"], number[], Partial<Scenario["destinations"]>, string[]]> = [
    ["Owner hides the amount on a campaign page", "explicit", "happy_path", [0], { manual: true, qase: true, automation: true }, []],
    ["Owner restores the amount to visible", "explicit", "happy_path", [0], { manual: true, qase: true }, []],
    ["Hidden preference persists across a new session", "explicit", "persistence", [1], { qase: true, automation: true }, []],
    ["Non-owner cannot change amount visibility", "explicit", "permissions", [2], { qase: true, automation: true }, []],
    ["Administrator can change amount visibility", "explicit", "permissions", [2], { manual: true, qase: true }, []],
    [
      "Existing campaign remains visible after deployment",
      "explicit",
      "regression",
      [3],
      { qase: true },
      ["A migration default could accidentally hide existing totals."],
    ],
    ["API returns the visibility preference", "explicit", "api", [4], { qase: true, automation: true }, []],
    ["API rejects visibility updates from unauthorised users", "explicit", "api", [2, 4], { automation: true }, []],
    [
      "Team fundraising page honours the hidden preference",
      "inferred",
      "compatibility",
      [0],
      { manual: true },
      ["Different page types may use separate total components."],
    ],
    [
      "Shared social preview does not reveal a hidden amount",
      "inferred",
      "regression",
      [0],
      { manual: true, qase: true },
      ["Server-rendered metadata could disclose the amount."],
    ],
    [
      "Analytics events avoid including the hidden amount",
      "inferred",
      "regression",
      [0],
      { manual: true },
      ["Client analytics payloads may still expose the value."],
    ],
    ["Rapidly toggling visibility resolves to the final choice", "inferred", "boundary", [0, 1], { automation: true }, []],
    ["Failed save leaves the previous preference intact", "inferred", "negative", [1], { manual: true, qase: true }, []],
    ["Keyboard user can find and operate the visibility control", "human", "compatibility", [0], { manual: true }, []],
    ["Visibility label clearly describes public impact", "human", "validation", [0], { manual: true }, []],
    [
      "Cached campaign pages reflect a visibility change",
      "inferred",
      "persistence",
      [0, 1],
      { manual: true },
      ["CDN caching could continue serving the amount."],
    ],
    ["Currency formatting remains correct when visibility is restored", "inferred", "regression", [0], { automation: true }, []],
  ];
  const scenarios = seeds.map(([title, origin, category, requirementIndexes, destinations, risks], index) =>
    scenario(
      title,
      origin,
      category,
      requirementIndexes.map((item) => requirements[item].id),
      destinations,
      risks,
      index < 13 ? "accepted" : index === 13 ? "rejected" : "proposed",
    ),
  );
  if (stress) {
    for (let index = scenarios.length; index < 200; index += 1) {
      scenarios.push(
        scenario(
          `Stress scenario ${index + 1}: visibility behaviour remains consistent`,
          index % 3 ? "inferred" : "explicit",
          index % 2 ? "regression" : "boundary",
          [requirements[index % 5].id],
          { manual: index % 2 === 0, automation: index % 5 === 0 },
          [],
          index % 4 ? "proposed" : "accepted",
        ),
      );
    }
  }
  const questions: Question[] = [
    question("Should hidden amounts also be suppressed on fundraiser and team pages?", "inferred", "open", requirements[0].id),
    question("Who counts as an administrator for this permission?", "explicit", "open", requirements[2].id),
    {
      ...question("Should existing campaigns change behaviour?", "explicit", "resolved", requirements[3].id),
      resolution: "No. Existing campaigns remain visible.",
      resolvedAt: createdAt,
    },
  ];
  return {
    id: randomUUID(),
    title: stress ? "Campaign amount visibility — stress fixture" : "Campaign amount visibility",
    status: "in_review",
    ticket: {
      reference: stress ? "DEV-200" : "EM-2841",
      title: "Allow fundraisers to hide amount raised",
      description:
        "Campaign owners need a privacy control for displaying the amount raised. Administrators should retain management access.",
      acceptanceCriteria:
        "A fundraiser can hide or show the amount raised. The choice persists. Existing campaigns remain visible by default. The campaign API exposes the preference.",
      qaContext: "Focus on public campaign, team and fundraiser surfaces. Preserve the current default.",
    },
    requirements,
    scenarios,
    questions,
    createdAt,
    updatedAt: createdAt,
  };
}

function requirement(text: string, source: Requirement["source"]): Requirement {
  return { id: randomUUID(), text, source, active: true, createdAt: now() };
}
function scenario(
  title: string,
  origin: Scenario["origin"],
  category: Scenario["category"],
  requirementIds: string[],
  destinations: Partial<Scenario["destinations"]>,
  risks: string[],
  review: Scenario["review"],
): Scenario {
  const timestamp = now();
  return {
    id: randomUUID(),
    title,
    expectedOutcome: `${title}. The product state and user feedback remain consistent with the requirement.`,
    origin,
    category,
    review,
    requirementIds,
    rationale: origin === "inferred" ? "Additional coverage for a plausible failure mode not stated by the ticket." : undefined,
    risks,
    destinations: { manual: false, qase: false, automation: false, ...destinations },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
function question(text: string, origin: Question["origin"], status: Question["status"], requirementId?: string): Question {
  return { id: randomUUID(), text, origin, status, requirementId, createdAt: now() };
}
