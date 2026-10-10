// Adapted from MIT-0 AWS AI-DLC 2a555f7a4387cd1b8254029cccb9fd1e99974574.
// Pure policy resolver, classifier, obligations and plan profile preserve executable upstream semantics.
import {createHash} from 'node:crypto';
const TESTING_HEADING='## Testing Posture',CONTRACT_HEADING='## Testing Contract';
const TESTABLE_LAYERS=['Data model / database behavior','Repository / data access','Business logic','API / endpoint','Frontend behavior'];
const STRUCTURED_FIELD_NAMES = ["Mode", "Methodology", "Ordering"]         ;
const STRUCTURED_FIELD_HEAD = new RegExp(
  `^[ \\t]*(?:\\*\\*)?(?:${STRUCTURED_FIELD_NAMES.join("|")})(?:\\*\\*)?[ \\t]*:`,
  "i",
);

// A `Field: value` line inside a memory section, with an optional list marker
// and optional bolding around the field name. Shared with Testing Posture so
// both memory sections read the same grammar.
export function structuredField(section        , field        )                {
  return structuredFieldSpan(section, field)?.value || null;
}

// Where that field sits: the head line and its wrapped continuation (line
// indices into `section` split on line breaks, end exclusive) and the joined
// value, so a writer can replace exactly the lines the reader read.
export function structuredFieldSpan(
  section        ,
  field        ,
)                                                       {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = section.split(/\r?\n/);
  const head = new RegExp(
    `^([ \\t]*)(?:[-*][ \\t]*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?[ \\t]*:[ \\t]*(.*?)[ \\t]*$`,
    "i",
  );
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(head);
    if (!match) continue;
    const headIndent = match[1].length;
    const parts = [match[2].trim()];
    // A wrapped value continues on lines indented deeper than its head until
    // a blank line, a line at the head's indentation or shallower (the next
    // paragraph), one of the structured fields (`Mode`, `Methodology`,
    // `Ordering`) starting at any indentation, with or without a space after
    // its colon, or a line opening another block: a list item of any marker,
    // a heading, a blockquote, a table row, or a fence. Markdown authors and
    // formatters wrap long bullets this way; the value is the joined prose.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const indent = (line.match(/^[ \t]*/)?.[0] ?? "").length;
      if (indent <= headIndent || !/\S/.test(line)) break;
      if (/^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|[>#|]|```|~~~)/.test(line)) break;
      if (STRUCTURED_FIELD_HEAD.test(line)) break;
      parts.push(line.trim());
    }
    return { start: i, end: i + parts.length, value: parts.filter(Boolean).join(" ") };
  }
  return null;
}

function canonicalize(value         )          {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value                           ;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function sha256(value        )         {
  return `sha256:${createHash("sha256").update(value, "utf-8").digest("hex")}`;
}

function hashObject(value         )         {
  return sha256(JSON.stringify(canonicalize(value)));
}

function normalizeMethodology(value        )                            {
  const normalized = value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .trim();
  if (/\b(custom|mixed)\b/.test(normalized)) return "custom";
  if (
    /\batdd\b|acceptance[- ]test[- ]driven|acceptance tests? (?:first|before)/.test(
      normalized,
    )
  ) {
    return "atdd";
  }
  if (
    /\bbdd\b|behaviou?r[- ]driven|(?:behaviou?r )?scenarios? (?:first|before)/.test(
      normalized,
    )
  ) {
    return "bdd";
  }
  if (
    /\btdd\b|test[- ]driven|(?:unit )?tests? (?:first|before implementation)/.test(
      normalized,
    )
  ) {
    return "tdd";
  }
  if (
    /\btest[- ]after\b|tests? after implementation|implementation[- ]first|classic/.test(
      normalized,
    )
  ) {
    return "test-after";
  }
  return null;
}

function structuredMethodology(value        )                     {
  const normalized = value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .trim();
  if (
    normalized === "tdd" ||
    normalized === "bdd" ||
    normalized === "atdd" ||
    normalized === "test-after" ||
    normalized === "custom"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid Testing Posture Methodology "${value}". Expected one of: tdd, bdd, atdd, test-after, custom.`,
  );
}

function defaultOrdering(methodology                    )         {
  switch (methodology) {
    case "tdd":
      return "For each testable layer: Red, then Green, then Refactor.";
    case "bdd":
      return "Define executable behavior scenarios before implementing each observable feature slice.";
    case "atdd":
      return "Write executable acceptance tests before implementing the complete feature across its required layers.";
    case "test-after":
      return "Implement each testable layer, then write and run that layer's tests.";
    case "custom":
      return "Preserve the explicitly affirmed custom ordering without converting it to another methodology.";
  }
}

                                                           

function isEscaped(line        , offset        )          {
  let backslashes = 0;
  for (let index = offset - 1; index >= 0 && line[index] === "\\"; index--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function hasMatchingTickRun(
  line        ,
  from        ,
  ticks        ,
)          {
  for (let cursor = from; cursor < line.length; cursor++) {
    if (line[cursor] !== "`" || isEscaped(line, cursor)) continue;
    let end = cursor + 1;
    while (line[end] === "`") end++;
    if (end - cursor === ticks) return true;
    cursor = end - 1;
  }
  return false;
}

function stripHtmlCommentsFromLine(
  rawLine        ,
  state                                                 ,
)         {
  let line = "";
  let cursor = 0;
  while (cursor < rawLine.length) {
    if (state.inComment) {
      const end = rawLine.indexOf("-->", cursor);
      if (end < 0) break;
      state.inComment = false;
      cursor = end + 3;
      continue;
    }
    if (
      rawLine[cursor] === "`" &&
      (state.inlineCodeTicks > 0 || !isEscaped(rawLine, cursor))
    ) {
      let end = cursor + 1;
      while (rawLine[end] === "`") end++;
      const ticks = end - cursor;
      if (
        state.inlineCodeTicks === 0 &&
        hasMatchingTickRun(rawLine, end, ticks)
      ) {
        state.inlineCodeTicks = ticks;
      } else if (state.inlineCodeTicks === ticks) state.inlineCodeTicks = 0;
      line += rawLine.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (
      state.inlineCodeTicks === 0 &&
      !isEscaped(rawLine, cursor) &&
      rawLine.startsWith("<!--", cursor)
    ) {
      state.inComment = true;
      cursor += 4;
      continue;
    }
    line += rawLine[cursor];
    cursor++;
  }
  return line;
}

function fenceOpening(line        )                       {
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (opening?.[1][0] === "`" && opening[2].includes("`")) return null;
  return opening
    ? {
        marker: opening[1][0]             ,
        length: opening[1].length,
      }
    : null;
}

function closesFence(line        , fence               )          {
  const closing = /^ {0,3}([`~]+)[ \t]*$/.exec(line);
  return Boolean(
    closing &&
      closing[1][0] === fence.marker &&
      Array.from(closing[1]).every((marker) => marker === fence.marker) &&
      closing[1].length >= fence.length,
  );
}

// Remove only rendered HTML comments. Fenced Markdown remains visible content,
// including literal <!-- tokens inside a fence.
function markdownWithoutHtmlComments(body        )         {
  const lines = body.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const state = { inComment: false, inlineCodeTicks: 0 };
  let fence                       = null;
  return lines
    .map((rawLine) => {
      if (fence) {
        if (closesFence(rawLine, fence)) fence = null;
        return rawLine;
      }
      const startedInComment = state.inComment;
      const line = stripHtmlCommentsFromLine(rawLine, state);
      const commentStart = rawLine.indexOf("<!--");
      const structuralPrefix =
        startedInComment || (line !== rawLine && commentStart < 0)
          ? ""
          : commentStart < 0
            ? rawLine
            : rawLine.slice(0, commentStart);
      const opening = fenceOpening(structuralPrefix);
      if (opening) {
        state.inComment = false;
        state.inlineCodeTicks = 0;
      }
      fence = opening;
      return opening ? rawLine : line;
    })
    .join("\n");
}

function structuralMarkdownLines(body        )           {
  const rawLines = body.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const visibleLines = markdownWithoutHtmlComments(body).split("\n");
  return visibleLines.map((line, index) => {
    const rawLine = rawLines[index];
    if (line === rawLine) return line;
    const opening = rawLine.indexOf("<!--");
    const closing = rawLine.indexOf("-->");
    return opening >= 0 && (closing < 0 || opening < closing)
      ? rawLine.slice(0, opening)
      : "";
  });
}

function visiblePostureText(section        )         {
  return markdownWithoutHtmlComments(section).trim();
}

function classifiablePostureText(section        )         {
  const lines = markdownWithoutHtmlComments(section).split("\n");
  const structuralLines = structuralMarkdownLines(section);
  let fence                       = null;
  return lines
    .map((line, index) => {
      const structuralLine = structuralLines[index];
      if (fence) {
        if (closesFence(structuralLine, fence)) fence = null;
        return "";
      }
      const opening = fenceOpening(structuralLine);
      if (opening) {
        fence = opening;
        return "";
      }
      return line;
    })
    .join("\n")
    .trim();
}

// Find the real Testing Posture section while ignoring headings hidden inside
// HTML comments or fenced examples. Return the original raw lines so comments
// and fences remain part of input_sha256 even though classification uses the
// visible projection above.
function extractTestingPostureSection(content        )         {
  const rawLines = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const visibleLines = structuralMarkdownLines(content);
  let fence                       = null;
  let bodyStart = -1;
  let bodyEnd = rawLines.length;

  for (let index = 0; index < visibleLines.length; index++) {
    const line = visibleLines[index];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opening = fenceOpening(line);
    if (opening) {
      fence = opening;
      continue;
    }
    if (bodyStart < 0) {
      if (line.trimEnd() === TESTING_HEADING) bodyStart = index + 1;
      continue;
    }
    if (/^## [^\n]*$/.test(line)) {
      bodyEnd = index;
      break;
    }
  }

  return bodyStart < 0 ? "" : rawLines.slice(bodyStart, bodyEnd).join("\n");
}

function classifyPosture(section        )                           {
  const body = classifiablePostureText(section);
  if (!body) return null;

  const structuredMethod = structuredField(body, "Methodology");
  const structuredOrdering = structuredField(body, "Ordering");
  const structured = structuredMethod
    ? structuredMethodology(structuredMethod)
    : null;
  const scan = `${structuredMethod ?? ""}\n${structuredOrdering ?? body}`.toLowerCase();
  const components = new Set                    ();
  for (const methodology of ["tdd", "bdd", "atdd", "test-after"]         ) {
    const detected = normalizeMethodology(
      methodology === "test-after"
        ? scan.match(
            /test[- ]after|tests? after implementation|implementation[- ]first|classic/,
          )?.[0] ?? ""
        : scan.match(
            methodology === "tdd"
              ? /\btdd\b|test[- ]driven/
              : methodology === "bdd"
                ? /\bbdd\b|behaviou?r[- ]driven/
                : /\batdd\b|acceptance[- ]test[- ]driven/,
          )?.[0] ?? "",
    );
    if (detected) components.add(detected);
  }

  const ordering = structuredOrdering ?? body;
  const mixedOrdering =
    (/\b(?:tests?|scenarios?)\b[^.\n]{0,80}\bfirst(?!-)\b/i.test(ordering) ||
      /\b(?:tests?|scenarios?)\b[^.\n]{0,80}\bbefore\b[^.\n]{0,40}\bimplement(?:ation|ing)?\b/i.test(
        ordering,
      )) &&
    (/\btests?\b[^.\n]{0,80}\bafter\b[^.\n]{0,40}\bimplement(?:ation|ing)?\b/i.test(
      ordering,
    ) ||
      /\brefactor(?:ing)?\b[^.\n]{0,80}\bafter\b[^.\n]{0,40}\bgreen\b/i.test(
        ordering,
      ) ||
      /\btests?\b[^.\n]{0,80}\bfollow\b[^.\n]{0,40}\bimplement(?:ation|ing)?\b/i.test(
        ordering,
      ));
  const customSignal =
    /\b(?:custom|mixed)[ -](?:ordering|cadence|posture|methodology)\b|\b(?:ordering|cadence|posture|methodology)[ -](?:custom|mixed)\b/i.test(
      body,
    );
  if (
    structured === null &&
    components.size > 1 &&
    !customSignal &&
    !mixedOrdering
  ) {
    return null;
  }
  const methodology =
    structured ??
    (customSignal || mixedOrdering
      ? "custom"
      : Array.from(components)[0] ?? null);
  if (methodology === null) return null;

  if (methodology !== "custom") components.add(methodology);
  return {
    methodology,
    ordering:
      structuredOrdering ??
      (methodology === "custom" ? body.replace(/\s+/g, " ").trim() : defaultOrdering(methodology)),
    components: Array.from(components),
  };
}

function compatibleSpecialization(
  broader                   ,
  narrower                   ,
)          {
  if (broader.methodology === narrower.methodology) return true;
  return (
    narrower.methodology === "custom" &&
    narrower.components.includes(broader.methodology)
  );
}

export function combineTestObligations(
  scope        ,
  strategy              ,
)                  {
  const strategyVolume                                 = {
    minimal: [
      "One verifiable test per requirement at the narrowest effective level.",
      "At least one happy-path unit test per component.",
      "Unit tests are the default; a bugfix/security scope floor may require an integration or E2E regression when that is the narrowest level that reproduces the defect.",
    ],
    standard: [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them.",
    ],
    comprehensive: [
      "Ten to fifteen tests per component.",
      "Unit, integration, and E2E tests.",
      "Add performance and security tests when NFRs demand them.",
    ],
  };
  const normalizedScope = scope.trim().toLowerCase();
  let scopeFloor          ;
  if (["mvp", "enterprise", "feature", "infra"].includes(normalizedScope)) {
    scopeFloor = [
      "Meet an 80% line-coverage floor.",
      "Run the selected tests in CI before merge.",
    ];
  } else if (["bugfix", "security-patch"].includes(normalizedScope)) {
    scopeFloor = [
      "Include a targeted regression for the bug or vulnerability.",
      "Keep the existing test suite green.",
    ];
  } else {
    scopeFloor = [
      "Keep the existing test suite green.",
      "This scope adds no extra new-test floor beyond the selected test strategy.",
    ];
  }
  return {
    strategy,
    strategy_volume: strategyVolume[strategy],
    scope_floor: scopeFloor,
    combination_rule:
      "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default.",
  };
}

export function buildPlanProfile(
  methodology                    ,
  ordering        ,
  projectType             ,
)              {
  const runnerStep =
    projectType === "greenfield"
      ? "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command."
      : "Verify the existing test runner/configuration and record the exact unit-scoped command.";
  const steps = [
    "Project structure and production configuration skeleton.",
    runnerStep,
  ];

  if (methodology === "tdd") {
    for (const layer of TESTABLE_LAYERS) {
      steps.push(
        `${layer} - Red: write the failing tests and record the failing command output.`,
        `${layer} - Green: implement only enough behavior to pass.`,
        `${layer} - Refactor: improve the implementation while tests stay green.`,
      );
    }
  } else if (methodology === "bdd") {
    steps.push(
      "Behavior scenarios - define executable examples for the observable feature slice before implementation.",
      "Feature slice - implement the required data, repository, business, API, and frontend layers.",
      "Behavior scenarios - run the scenarios until they pass.",
      "Feature slice - refactor while the scenarios stay green.",
    );
  } else if (methodology === "atdd") {
    steps.push(
      "Acceptance Red - write executable acceptance tests for the complete feature before implementation.",
      "Feature implementation - implement the required layers against the acceptance contract.",
      "Acceptance Green - run the acceptance tests until they pass.",
      "Feature Refactor - improve the cross-layer implementation while acceptance stays green.",
    );
  } else if (methodology === "custom") {
    steps.push(
      `Custom ordering - ${ordering}`,
      "Implementation and tests - preserve that exact ordering; do not convert it to layer-local TDD.",
    );
  } else {
    for (const layer of TESTABLE_LAYERS) {
      steps.push(
        `${layer} - implement.`,
        `${layer} - write and run its tests after implementation.`,
      );
    }
  }

  steps.push(
    "Environment/build configuration.",
    "Documentation and traceability.",
  );
  return {
    methodology,
    runner_step: runnerStep,
    runner_ready_before_first_test: true,
    testable_layers: TESTABLE_LAYERS.slice(),
    steps,
  };
}

export function resolveTestingPostureFromSections(
  sections                        ,
  options   
                  
                               
                             
   ,
)                         {
  const classified = {
    org: classifyPosture(sections.org ?? ""),
    team: classifyPosture(sections.team ?? ""),
    project: classifyPosture(sections.project ?? ""),
  };

  if (
    classified.team &&
    classified.project &&
    !compatibleSpecialization(classified.team, classified.project)
  ) {
    throw new Error(
      `Testing Posture conflict: project methodology "${classified.project.methodology}" ` +
        `contradicts team methodology "${classified.team.methodology}". Revise the narrower rule; ` +
        "strict-additive memory does not permit runtime override.",
    );
  }

  const selected =
    classified.project
      ? { layer: "project"         , value: classified.project }
      : classified.team
        ? { layer: "team"         , value: classified.team }
        : classified.org
          ? { layer: "org"         , value: classified.org }
          : {
              layer: "fallback"         ,
              value: {
                methodology: "test-after"         ,
                ordering: defaultOrdering("test-after"),
                components: ["test-after"         ],
              },
            };
  const applicableNotes = (["org", "team", "project"]         )
    .map((layer) => ({
      layer,
      text: visiblePostureText(sections[layer] ?? ""),
    }))
    .filter((entry) => entry.text.length > 0);
  const input = {
    sections: {
      org: sections.org ?? "",
      team: sections.team ?? "",
      project: sections.project ?? "",
    },
    scope: options.scope,
    test_strategy: options.testStrategy,
    project_type: options.projectType,
  };
  const body                             = {
    version: 1,
    methodology: selected.value.methodology,
    source: selected.layer,
    ordering: selected.value.ordering,
    scope: options.scope,
    test_strategy: options.testStrategy,
    project_type: options.projectType,
    applicable_notes: applicableNotes,
    obligations: combineTestObligations(options.scope, options.testStrategy),
    plan_profile: buildPlanProfile(
      selected.value.methodology,
      selected.value.ordering,
      options.projectType,
    ),
    input_sha256: hashObject(input),
  };
  return { ...body, contract_sha256: hashObject(body) };
}

export function renderTestingContract(contract                        )         {
  return `${CONTRACT_HEADING}\n\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n`;
}


export {extractTestingPostureSection,canonicalize,hashObject,structuralMarkdownLines,fenceOpening,closesFence};
