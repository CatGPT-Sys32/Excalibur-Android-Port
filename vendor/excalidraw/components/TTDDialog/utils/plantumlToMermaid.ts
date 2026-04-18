const WRAPPER_DIRECTIVE_RE = /^@(start\w+|end\w+)\b/i;
const COMMENT_LINE_RE = /^\s*('|\/\/|#)/;
const DIRECTIVE_LINE_RE = /^\s*![a-z]/i;
const IGNORE_LINE_RE =
  /^\s*(skinparam\b|hide\b|(?:title|caption)\b(?!\s*:))/i;
const DIRECTION_RE = /^\s*(left to right|right to left|top to bottom|bottom to top)\s+direction\s*$/i;
const VALID_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SEQUENCE_ARROWS = [
  "<<-->>",
  "<<->>",
  "-->>",
  "->>",
  "<-->",
  "<->",
  "<--",
  "<-",
  "-->",
  "->",
] as const;

const CLASS_RELATION_ARROWS = [
  "<|..",
  "..|>",
  "<|--",
  "--|>",
  "*--",
  "--*",
  "o--",
  "--o",
  "<..",
  "..>",
  "<--",
  "-->",
  "..",
  "--",
] as const;

const CLASS_DISCRIMINATING_ARROWS = [
  "<|..",
  "..|>",
  "<|--",
  "--|>",
  "*--",
  "--*",
  "o--",
  "--o",
] as const;

const FLOW_ARROWS = [
  "-left->",
  "-right->",
  "-up->",
  "-down->",
  ...CLASS_RELATION_ARROWS,
  ...SEQUENCE_ARROWS,
] as const;

type ParsedArrowLine = {
  from: string;
  to: string;
  arrow: string;
  label: string;
};

type ErRelation = ParsedArrowLine;

type FlowNodeShape =
  | "rect"
  | "diamond"
  | "round"
  | "stadium"
  | "circle"
  | "cylinder";

type FlowNode = {
  id: string;
  label: string;
  shape: FlowNodeShape;
};

type FlowContainer = {
  id: string;
  label: string;
  parentId: string | null;
};

export type PlantUmlDiagnostic = {
  lineNumber: number | null;
  lineText: string;
  diagramType:
    | "sequence"
    | "class"
    | "entity/er"
    | "state"
    | "mindmap"
    | "component/use case"
    | "flow/activity";
  hint: string;
};

export class PlantUmlConversionError extends Error {
  diagnostic: PlantUmlDiagnostic;

  constructor(message: string, diagnostic: PlantUmlDiagnostic) {
    super(message);
    this.name = "PlantUmlConversionError";
    this.diagnostic = diagnostic;
  }
}

export const getPlantUmlDiagnostic = (error: Error | null) => {
  if (error instanceof PlantUmlConversionError) {
    return error.diagnostic;
  }

  return null;
};

const normalizeLine = (line: string) => line.trim();

const stripQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const escapeMermaidText = (value: string) =>
  value.replace(/\|/g, "\\|").replace(/"/g, '\\"');

const toIdentifier = (raw: string, fallbackPrefix: string, index: number) => {
  const normalized = stripQuotes(raw)
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return `${fallbackPrefix}_${index}`;
  }

  if (/^[0-9]/.test(normalized)) {
    return `${fallbackPrefix}_${normalized}`;
  }

  return normalized;
};

const normalizePlantUml = (definition: string) =>
  definition
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line && !WRAPPER_DIRECTIVE_RE.test(line))
    .filter((line) => !COMMENT_LINE_RE.test(line))
    .filter((line) => !DIRECTIVE_LINE_RE.test(line))
    .filter((line) => !IGNORE_LINE_RE.test(line));

const findDiagnosticLine = (definition: string, lines: readonly string[]) => {
  const rawLines = definition.replace(/\r\n?/g, "\n").split("\n");
  const targetLine = lines.find((line) => line.trim()) ?? "";

  if (targetLine) {
    const targetIndex = rawLines.findIndex(
      (line) => normalizeLine(line) === targetLine,
    );
    if (targetIndex >= 0) {
      return {
        lineNumber: targetIndex + 1,
        lineText: rawLines[targetIndex],
      };
    }
  }

  const fallbackIndex = rawLines.findIndex((line) => {
    const normalized = normalizeLine(line);
    return (
      normalized &&
      !WRAPPER_DIRECTIVE_RE.test(normalized) &&
      !COMMENT_LINE_RE.test(normalized) &&
      !DIRECTIVE_LINE_RE.test(normalized) &&
      !IGNORE_LINE_RE.test(normalized)
    );
  });

  return fallbackIndex >= 0
    ? {
        lineNumber: fallbackIndex + 1,
        lineText: rawLines[fallbackIndex],
      }
    : {
        lineNumber: null,
        lineText: "",
      };
};

const diagnosticHintByType: Record<PlantUmlDiagnostic["diagramType"], string> = {
  sequence: "Use participant/actor declarations and message arrows such as Alice -> Bob: text.",
  class: "Use class or interface declarations and relationship arrows such as A --|> B.",
  "entity/er": "Use entity blocks and crow's-foot relationships such as CUSTOMER ||--o{ ORDER : places.",
  state: "Use [*], state declarations, and transitions such as Idle --> Running.",
  mindmap: "Use bullet levels such as * Root and ** Child.",
  "component/use case": "Use actor, usecase, component, package, node, and relationship arrows such as User --> Login.",
  "flow/activity": "Use activity steps like :Step; or relationship arrows such as A --> B.",
};

const toPlantUmlConversionError = (
  error: unknown,
  definition: string,
  lines: readonly string[],
  diagramType: PlantUmlDiagnostic["diagramType"],
) => {
  const source = findDiagnosticLine(definition, lines);
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Invalid PlantUML definition";
  const diagnostic: PlantUmlDiagnostic = {
    ...source,
    diagramType,
    hint: diagnosticHintByType[diagramType],
  };

  return new PlantUmlConversionError(
    source.lineNumber
      ? `${message}\nLine ${source.lineNumber}: ${source.lineText.trim()}\nHint: ${diagnostic.hint}`
      : `${message}\nHint: ${diagnostic.hint}`,
    diagnostic,
  );
};

const splitStatementAndLabel = (line: string) => {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return {
      statement: line.trim(),
      label: "",
    };
  }

  return {
    statement: line.slice(0, separatorIndex).trim(),
    label: line.slice(separatorIndex + 1).trim(),
  };
};

const prepareArrowStatement = (statement: string) =>
  statement
    .replace(/-\[[^\]]+\]/g, "-")
    .replace(/-left->/gi, "-->")
    .replace(/-right->/gi, "-->")
    .replace(/-up->/gi, "-->")
    .replace(/-down->/gi, "-->")
    .replace(/\s+/g, " ")
    .trim();

const parseArrowLine = (
  line: string,
  candidates: readonly string[],
): ParsedArrowLine | null => {
  const { statement, label } = splitStatementAndLabel(line);
  const normalizedStatement = prepareArrowStatement(statement);

  let best:
    | {
        index: number;
        arrow: string;
      }
    | null = null;

  for (const arrow of candidates) {
    let index = normalizedStatement.indexOf(arrow);
    while (index !== -1) {
      const left = normalizedStatement.slice(0, index).trim();
      const right = normalizedStatement.slice(index + arrow.length).trim();

      if (left && right) {
        if (
          !best ||
          index < best.index ||
          (index === best.index && arrow.length > best.arrow.length)
        ) {
          best = {
            index,
            arrow,
          };
        }
        break;
      }

      index = normalizedStatement.indexOf(arrow, index + 1);
    }
  }

  if (!best) {
    return null;
  }

  const from = normalizedStatement.slice(0, best.index).trim();
  const to = normalizedStatement.slice(best.index + best.arrow.length).trim();

  if (!from || !to) {
    return null;
  }

  return {
    from,
    to,
    arrow: best.arrow,
    label,
  };
};

const ER_RELATION_RE =
  /^(.+?)\s+((?:\|\||o\{|\|\{|\}\||\}o)(?:--|\.\.)(?:\|\||o\{|\|\{|\}\||\}o))\s+(.+?)(?:\s*:\s*(.+))?$/;

const parseErRelation = (line: string): ErRelation | null => {
  const relationMatch = line.match(ER_RELATION_RE);
  if (!relationMatch) {
    return null;
  }

  return {
    from: relationMatch[1].trim(),
    arrow: relationMatch[2].trim(),
    to: relationMatch[3].trim(),
    label: relationMatch[4]?.trim() || "",
  };
};

const isLikelyEr = (lines: readonly string[]) =>
  lines.some((line) => /^(entity|table)\s+.+\{$/i.test(line)) ||
  lines.some((line) => parseErRelation(line) !== null);

const isLikelyComponentOrUseCase = (lines: readonly string[]) =>
  lines.some((line) =>
    /^(usecase|component|package|node|artifact|folder|frame|cloud|rectangle|object|map|storage|file|card)\b/i.test(
      line,
    ),
  ) ||
  lines.some(
    (line) =>
      parseArrowLine(line, FLOW_ARROWS) !== null &&
      /(?:\[[^\]]+\]|\([^)]+\))/.test(line),
  );

const isLikelyClass = (lines: readonly string[]) =>
  lines.some((line) =>
    /^(abstract\s+class|class|interface|enum|annotation)\b/i.test(line),
  ) ||
  lines.some(
    (line) => parseArrowLine(line, CLASS_DISCRIMINATING_ARROWS) !== null,
  );

const hasLikelySequenceMessage = (line: string) => {
  const arrowLine = parseArrowLine(line, SEQUENCE_ARROWS);
  if (!arrowLine) {
    return false;
  }

  return (
    arrowLine.arrow.includes(">>") ||
    arrowLine.arrow === "->" ||
    arrowLine.arrow === "<-" ||
    arrowLine.arrow === "<->"
  );
};

const isLikelySequence = (lines: readonly string[]) =>
  lines.some((line) =>
    /^(participant|activate|deactivate|autonumber|note|loop|alt|opt|par|critical|break|group|end)\b/i.test(
      line,
    ),
  ) ||
  lines.some((line) => hasLikelySequenceMessage(line)) ||
  (lines.some((line) =>
    /^(actor|boundary|control|entity|database|collections|queue)\b/i.test(
      line,
    ),
  ) &&
    lines.some((line) => parseArrowLine(line, SEQUENCE_ARROWS) !== null));

const isLikelyMindmap = (lines: readonly string[]) => {
  const branchLineCount = lines.filter((line) => /^[*+-]{1,}\s+\S+/.test(line)).length;
  if (branchLineCount === 0) {
    return false;
  }

  if (lines.some((line) => parseArrowLine(line, FLOW_ARROWS) !== null)) {
    return false;
  }

  return branchLineCount >= 2 || (branchLineCount === 1 && lines.length === 1);
};

const isLikelyState = (lines: readonly string[]) =>
  lines.some((line) => /^state\b/i.test(line)) ||
  lines.some((line) => /\[[^\]]*\*[^\]]*\]/.test(line));

const toMermaidSequenceArrow = (arrow: string) => {
  if (arrow.includes("--") && arrow.includes(">>")) {
    return "-->>";
  }
  if (arrow.includes(">>")) {
    return "->>";
  }
  if (arrow.includes("--")) {
    return "-->";
  }
  return "->";
};

const convertSequence = (lines: readonly string[]) => {
  const mermaidLines: string[] = ["sequenceDiagram"];
  const aliases = new Map<string, string>();
  let fallbackIndex = 1;

  const resolveParticipant = (raw: string) => {
    const cleaned = stripQuotes(raw);
    return aliases.get(cleaned) ?? toIdentifier(cleaned, "P", fallbackIndex++);
  };

  for (const line of lines) {
    const declarationMatch = line.match(
      /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+?)(?:\s+as\s+(.+))?$/i,
    );
    if (declarationMatch) {
      const declarationType = declarationMatch[1].toLowerCase();
      const rawLabel = stripQuotes(declarationMatch[2]);
      const rawAlias = stripQuotes(declarationMatch[3] || rawLabel);
      const alias = VALID_IDENTIFIER_RE.test(rawAlias)
        ? rawAlias
        : toIdentifier(rawAlias, "P", fallbackIndex++);
      const declarationKeyword = declarationType === "actor" ? "actor" : "participant";

      aliases.set(rawLabel, alias);
      aliases.set(alias, alias);

      if (alias === rawLabel) {
        mermaidLines.push(`  ${declarationKeyword} ${alias}`);
      } else {
        mermaidLines.push(
          `  ${declarationKeyword} ${alias} as ${escapeMermaidText(rawLabel)}`,
        );
      }
      continue;
    }

    const messageLine = parseArrowLine(line, SEQUENCE_ARROWS);
    if (messageLine) {
      const isBidirectional =
        messageLine.arrow.includes("<->") || messageLine.arrow.includes("<-->");
      const shouldReverse =
        !isBidirectional && messageLine.arrow.startsWith("<") && !messageLine.arrow.startsWith("<<");
      const from = resolveParticipant(
        shouldReverse ? messageLine.to : messageLine.from,
      );
      const to = resolveParticipant(
        shouldReverse ? messageLine.from : messageLine.to,
      );
      const mermaidArrow = toMermaidSequenceArrow(messageLine.arrow);
      const suffix = messageLine.label
        ? `: ${escapeMermaidText(messageLine.label)}`
        : "";
      mermaidLines.push(`  ${from} ${mermaidArrow} ${to}${suffix}`);
      continue;
    }

    const noteMatch = line.match(/^note\s+(left|right)\s+of\s+([^:]+):\s*(.+)$/i);
    if (noteMatch) {
      const side = noteMatch[1].toLowerCase();
      const participant = resolveParticipant(noteMatch[2]);
      mermaidLines.push(
        `  Note ${side} of ${participant}: ${escapeMermaidText(noteMatch[3])}`,
      );
      continue;
    }

    const overNoteMatch = line.match(/^note\s+over\s+([^:]+):\s*(.+)$/i);
    if (overNoteMatch) {
      const participants = overNoteMatch[1]
        .split(",")
        .map((token) => resolveParticipant(token))
        .join(",");
      mermaidLines.push(
        `  Note over ${participants}: ${escapeMermaidText(overNoteMatch[2])}`,
      );
      continue;
    }

    if (
      /^(activate|deactivate|autonumber|loop|alt|opt|par|and|else|break|critical|group|end|destroy)\b/i.test(
        line,
      )
    ) {
      mermaidLines.push(`  ${line}`);
      continue;
    }
  }

  if (mermaidLines.length <= 1) {
    throw new Error(
      "Could not parse PlantUML sequence syntax. Try using explicit participant and arrow lines.",
    );
  }

  return mermaidLines.join("\n");
};

const convertClassDiagram = (lines: readonly string[]) => {
  const mermaidLines: string[] = ["classDiagram"];
  const aliases = new Map<string, string>();
  const classMembers = new Map<string, string[]>();
  const classStereotypes = new Map<string, string>();
  const relationships: string[] = [];
  let fallbackIndex = 1;
  let currentClassId: string | null = null;

  const ensureClassId = (raw: string) => {
    const cleaned = stripQuotes(raw).trim();
    const existing = aliases.get(cleaned);
    if (existing) {
      return existing;
    }

    const id = VALID_IDENTIFIER_RE.test(cleaned)
      ? cleaned
      : toIdentifier(cleaned, "C", fallbackIndex++);
    aliases.set(cleaned, id);
    aliases.set(id, id);

    if (!classMembers.has(id)) {
      classMembers.set(id, []);
      mermaidLines.push(`  class ${id}`);
    }

    return id;
  };

  const addClassMember = (classId: string, member: string) => {
    if (!member.trim()) {
      return;
    }

    if (!classMembers.has(classId)) {
      classMembers.set(classId, []);
    }

    classMembers.get(classId)!.push(member.trim());
  };

  for (const line of lines) {
    if (line === "}") {
      currentClassId = null;
      continue;
    }

    if (currentClassId) {
      if (!/^--+$/.test(line)) {
        addClassMember(currentClassId, line);
      }
      continue;
    }

    const declarationMatch = line.match(
      /^(abstract\s+class|class|interface|enum|annotation)\s+(.+?)(?:\s+as\s+(.+?))?\s*(\{)?$/i,
    );
    if (declarationMatch) {
      const declarationType = declarationMatch[1].toLowerCase();
      const label = stripQuotes(declarationMatch[2]).split(/\s+(extends|implements)\b/i)[0];
      const aliasCandidate = stripQuotes(declarationMatch[3] || "");
      const classId = ensureClassId(aliasCandidate || label);

      if (aliasCandidate) {
        aliases.set(label, classId);
      }

      if (declarationType === "interface") {
        classStereotypes.set(classId, "interface");
      } else if (declarationType === "enum") {
        classStereotypes.set(classId, "enum");
      } else if (declarationType === "annotation") {
        classStereotypes.set(classId, "annotation");
      } else if (declarationType === "abstract class") {
        classStereotypes.set(classId, "abstract");
      }

      if (line.endsWith("{")) {
        currentClassId = classId;
      }
      continue;
    }

    const relation = parseArrowLine(line, CLASS_RELATION_ARROWS);
    if (relation) {
      let from = ensureClassId(relation.from);
      let to = ensureClassId(relation.to);
      let arrow = relation.arrow;

      if (arrow === "--|>") {
        arrow = "<|--";
        [from, to] = [to, from];
      } else if (arrow === "..|>") {
        arrow = "<|..";
        [from, to] = [to, from];
      } else if (arrow === "--*") {
        arrow = "*--";
        [from, to] = [to, from];
      } else if (arrow === "--o") {
        arrow = "o--";
        [from, to] = [to, from];
      }

      const supportedArrow =
        ["<|--", "<|..", "*--", "o--", "--", "..", "-->", "<--", "..>", "<.."].includes(arrow)
          ? arrow
          : "-->";

      const label = relation.label ? ` : ${escapeMermaidText(relation.label)}` : "";
      relationships.push(`  ${from} ${supportedArrow} ${to}${label}`);
      continue;
    }

    const memberMatch = line.match(/^(.+?)\s*:\s*(.+)$/);
    if (memberMatch) {
      const classId = ensureClassId(memberMatch[1]);
      addClassMember(classId, memberMatch[2]);
    }
  }

  for (const [classId, stereotype] of classStereotypes.entries()) {
    addClassMember(classId, `<<${stereotype}>>`);
  }

  for (const [classId, members] of classMembers.entries()) {
    for (const member of members) {
      mermaidLines.push(`  ${classId} : ${escapeMermaidText(member)}`);
    }
  }

  mermaidLines.push(...relationships);

  if (mermaidLines.length <= 1) {
    throw new Error(
      "Could not parse PlantUML class syntax. Try using class/interface declarations and relationship arrows.",
    );
  }

  return mermaidLines.join("\n");
};

const sanitizeErType = (rawType: string) => {
  const normalized = rawType
    .replace(/<<[^>]+>>/g, "")
    .replace(/[{}()[\],]/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "string";
};

const parseErAttribute = (line: string) => {
  let cleaned = line.trim();
  if (!cleaned || /^[-=]+$/.test(cleaned)) {
    return null;
  }

  const keys = new Set<string>();
  if (/^\*/.test(cleaned)) {
    keys.add("PK");
  }
  if (/^#/.test(cleaned)) {
    keys.add("FK");
  }

  cleaned = cleaned
    .replace(/^[*#+~\-\s]+/, "")
    .replace(/<<\s*(PK|FK|UK)\s*>>/gi, (_match: string, key: string) => {
      keys.add(key.toUpperCase());
      return "";
    })
    .trim();

  if (!cleaned) {
    return null;
  }

  const colonIndex = cleaned.indexOf(":");
  let rawName = "";
  let rawType = "";

  if (colonIndex >= 0) {
    rawName = cleaned.slice(0, colonIndex).trim();
    rawType = cleaned.slice(colonIndex + 1).trim();
  } else {
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 2) {
      rawType = parts[0];
      rawName = parts.slice(1).join("_");
    } else {
      rawName = cleaned;
      rawType = "string";
    }
  }

  const name = toIdentifier(rawName, "field", 1);
  const type = sanitizeErType(rawType || "string");
  const keySuffix = Array.from(keys).join(",");

  return keySuffix ? `${type} ${name} ${keySuffix}` : `${type} ${name}`;
};

const convertErDiagram = (lines: readonly string[]) => {
  const mermaidLines: string[] = ["erDiagram"];
  const aliases = new Map<string, string>();
  const attributes = new Map<string, string[]>();
  const relationships: string[] = [];
  let fallbackIndex = 1;
  let currentEntityId: string | null = null;

  const ensureEntityId = (raw: string) => {
    const cleaned = stripQuotes(raw)
      .replace(/^[[({]+/, "")
      .replace(/[\])}]+$/, "")
      .trim();
    const existing = aliases.get(cleaned);
    if (existing) {
      return existing;
    }

    const entityId = VALID_IDENTIFIER_RE.test(cleaned)
      ? cleaned
      : toIdentifier(cleaned, "E", fallbackIndex++);
    aliases.set(cleaned, entityId);
    aliases.set(entityId, entityId);

    if (!attributes.has(entityId)) {
      attributes.set(entityId, []);
    }

    return entityId;
  };

  for (const line of lines) {
    if (line === "}") {
      currentEntityId = null;
      continue;
    }

    if (currentEntityId) {
      const attribute = parseErAttribute(line);
      if (attribute) {
        attributes.get(currentEntityId)!.push(attribute);
      }
      continue;
    }

    const entityMatch = line.match(
      /^(entity|table)\s+(.+?)(?:\s+as\s+(.+?))?\s*(\{)?$/i,
    );
    if (entityMatch) {
      const label = stripQuotes(entityMatch[2]);
      const aliasCandidate = stripQuotes(entityMatch[3] || label);
      const entityId = ensureEntityId(aliasCandidate);
      aliases.set(label, entityId);

      if (entityMatch[4]) {
        currentEntityId = entityId;
      }
      continue;
    }

    const relation = parseErRelation(line);
    if (relation) {
      const from = ensureEntityId(relation.from);
      const to = ensureEntityId(relation.to);
      const label = relation.label ? escapeMermaidText(relation.label) : "relates";
      relationships.push(`  ${from} ${relation.arrow} ${to} : ${label}`);
      continue;
    }
  }

  for (const [entityId, entityAttributes] of attributes.entries()) {
    if (!entityAttributes.length) {
      continue;
    }

    mermaidLines.push(`  ${entityId} {`);
    for (const attribute of entityAttributes) {
      mermaidLines.push(`    ${attribute}`);
    }
    mermaidLines.push("  }");
  }

  mermaidLines.push(...relationships);

  if (mermaidLines.length <= 1) {
    throw new Error(
      "Could not parse PlantUML entity syntax. Try using entity blocks and crow's-foot relationships.",
    );
  }

  return mermaidLines.join("\n");
};

const convertStateDiagram = (lines: readonly string[]) => {
  const mermaidLines: string[] = ["stateDiagram-v2"];
  const declarations = new Set<string>();
  const body: string[] = [];
  const aliases = new Map<string, string>();
  const fallbackIndex = { value: 1 };

  const resolveState = (token: string) => {
    const cleaned = stripQuotes(token).trim();
    if (!cleaned) {
      return "";
    }

    if (/^\[[^\]]+\]$/.test(cleaned)) {
      return cleaned;
    }

    const existing = aliases.get(cleaned);
    if (existing) {
      return existing;
    }

    if (VALID_IDENTIFIER_RE.test(cleaned)) {
      aliases.set(cleaned, cleaned);
      return cleaned;
    }

    const stateId = toIdentifier(cleaned, "S", fallbackIndex.value++);
    aliases.set(cleaned, stateId);
    aliases.set(stateId, stateId);
    declarations.add(`  state "${escapeMermaidText(cleaned)}" as ${stateId}`);
    return stateId;
  };

  const registerAlias = (displayName: string, aliasCandidate: string) => {
    const name = stripQuotes(displayName).trim();
    const rawAlias = stripQuotes(aliasCandidate).trim();
    if (!name || !rawAlias) {
      return "";
    }

    const alias = VALID_IDENTIFIER_RE.test(rawAlias)
      ? rawAlias
      : toIdentifier(rawAlias, "S", fallbackIndex.value++);
    aliases.set(name, alias);
    aliases.set(alias, alias);
    declarations.add(`  state "${escapeMermaidText(name)}" as ${alias}`);
    return alias;
  };

  for (const line of lines) {
    if (/^stateDiagram\b/i.test(line)) {
      continue;
    }

    if (line === "}") {
      body.push("  }");
      continue;
    }

    const stateDeclarationMatch = line.match(/^state\s+(.+)$/i);
    if (stateDeclarationMatch) {
      let stateBody = stateDeclarationMatch[1].trim();
      let startsBlock = false;

      if (stateBody.endsWith("{")) {
        startsBlock = true;
        stateBody = stateBody.slice(0, -1).trim();
      }

      const descriptionMatch = stateBody.match(/^(.+?)\s*:\s*(.+)$/);
      if (descriptionMatch) {
        const leftPart = descriptionMatch[1].trim();
        const description = descriptionMatch[2].trim();
        const aliasMatch = leftPart.match(/^(.+?)\s+as\s+(.+)$/i);
        const stateId = aliasMatch
          ? registerAlias(aliasMatch[1], aliasMatch[2])
          : resolveState(leftPart);

        if (stateId && description) {
          body.push(`  ${stateId} : ${escapeMermaidText(description)}`);
        }
        continue;
      }

      const aliasMatch = stateBody.match(/^(.+?)\s+as\s+(.+)$/i);
      const stateId = aliasMatch
        ? registerAlias(aliasMatch[1], aliasMatch[2])
        : resolveState(stateBody);

      if (startsBlock && stateId) {
        body.push(`  state ${stateId} {`);
      }
      continue;
    }

    const arrowLine = parseArrowLine(line, FLOW_ARROWS);
    if (!arrowLine) {
      continue;
    }

    const isBidirectional =
      arrowLine.arrow.includes("<->") || arrowLine.arrow.includes("<-->");
    const shouldReverse =
      !isBidirectional &&
      arrowLine.arrow.startsWith("<") &&
      !arrowLine.arrow.startsWith("<|");

    const fromState = resolveState(shouldReverse ? arrowLine.to : arrowLine.from);
    const toState = resolveState(shouldReverse ? arrowLine.from : arrowLine.to);
    if (!fromState || !toState) {
      continue;
    }

    const label = arrowLine.label ? ` : ${escapeMermaidText(arrowLine.label)}` : "";
    body.push(`  ${fromState} --> ${toState}${label}`);
  }

  mermaidLines.push(...declarations, ...body);

  if (mermaidLines.length <= 1) {
    throw new Error(
      "Could not parse PlantUML state diagram syntax. Try using state declarations and transition arrows.",
    );
  }

  return mermaidLines.join("\n");
};

const convertMindmap = (lines: readonly string[]) => {
  const branches: Array<{ depth: number; label: string }> = [];

  for (const line of lines) {
    const branchMatch = line.match(/^([*+-]+)\s+(.+)$/);
    if (!branchMatch) {
      continue;
    }

    const label = stripQuotes(branchMatch[2]).trim();
    if (!label) {
      continue;
    }

    branches.push({
      depth: branchMatch[1].length,
      label,
    });
  }

  if (!branches.length) {
    throw new Error(
      "Could not parse PlantUML mindmap syntax. Use bullet levels such as * Root and ** Child.",
    );
  }

  const rootDepth = branches[0].depth;
  const mermaidLines: string[] = ["mindmap"];

  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[index];
    const relativeDepth = Math.max(0, branch.depth - rootDepth);
    const indent = `  ${"  ".repeat(relativeDepth)}`;
    const label = escapeMermaidText(branch.label);

    if (index === 0) {
      mermaidLines.push(`  root((${label}))`);
      continue;
    }

    mermaidLines.push(`${indent}${label}`);
  }

  return mermaidLines.join("\n");
};

const normalizeFlowNode = (
  token: string,
  nodes: Map<string, FlowNode>,
  fallbackIndex: { value: number },
  shape: FlowNodeShape = "rect",
  labelOverride?: string,
) => {
  const cleaned = stripQuotes(token)
    .replace(/^[[({|]+/, "")
    .replace(/[\])}|]+$/, "")
    .replace(/^\*+\s*/, "")
    .trim();

  const id = VALID_IDENTIFIER_RE.test(cleaned)
    ? cleaned
    : toIdentifier(cleaned, "N", fallbackIndex.value++);
  const label = stripQuotes(labelOverride ?? cleaned)
    .replace(/^[[({|]+/, "")
    .replace(/[\])}|]+$/, "")
    .trim();

  const existing = nodes.get(id);
  if (!existing) {
    nodes.set(id, { id, label: label || cleaned || id, shape });
  } else if (existing.shape === "rect" && shape !== "rect") {
    existing.shape = shape;
  }

  return id;
};

const getFlowDeclarationShape = (kind: string): FlowNodeShape => {
  const normalizedKind = kind.toLowerCase();

  if (normalizedKind === "database" || normalizedKind === "storage") {
    return "cylinder";
  }

  if (normalizedKind === "actor" || normalizedKind === "usecase") {
    return "stadium";
  }

  if (normalizedKind === "interface") {
    return "circle";
  }

  return "rect";
};

const toFlowArrow = (arrow: string) => {
  if (arrow.includes("..")) {
    return "-.->";
  }
  return "-->";
};

const extractInlineActivityStatement = (segment: string) => {
  const trimmed = segment.trim();
  if (!trimmed) {
    return null;
  }

  const withoutEndif = trimmed.replace(/\bendif\b/gi, "").trim();
  if (!withoutEndif.startsWith(":")) {
    return null;
  }

  if (!withoutEndif.endsWith(";") && !withoutEndif.endsWith(":")) {
    return null;
  }

  const activityLabel = withoutEndif.slice(1, -1).trim();
  if (!activityLabel) {
    return null;
  }

  return `:${activityLabel};`;
};

const expandInlineConditionals = (lines: readonly string[]) => {
  const expanded: string[] = [];

  for (const rawLine of lines) {
    const ifMatch = rawLine.match(/^if\s*\((.+?)\)\s*then(?:\s*\((.+?)\))?\s*(.*)$/i);
    if (!ifMatch) {
      expanded.push(rawLine);
      continue;
    }

    const condition = ifMatch[1].trim();
    const thenLabel = ifMatch[2]?.trim();
    const suffix = ifMatch[3].trim();

    if (!suffix) {
      expanded.push(rawLine);
      continue;
    }

    expanded.push(`if (${condition}) then${thenLabel ? ` (${thenLabel})` : ""}`);

    const elseToken = /\belse\b/i.exec(suffix);
    const thenSegment = elseToken
      ? suffix.slice(0, elseToken.index).trim()
      : suffix;
    const elseSegment = elseToken
      ? suffix.slice(elseToken.index).trim()
      : "";

    const thenActivity = extractInlineActivityStatement(thenSegment);
    if (thenActivity) {
      expanded.push(thenActivity);
    }

    if (elseSegment) {
      const elseMatch = elseSegment.match(/^else(?:\s*\((.+?)\))?\s*(.*)$/i);
      if (elseMatch) {
        const elseLabel = elseMatch[1]?.trim();
        expanded.push(`else${elseLabel ? ` (${elseLabel})` : ""}`);

        const elseActivity = extractInlineActivityStatement(elseMatch[2] || "");
        if (elseActivity) {
          expanded.push(elseActivity);
        }
      }
    }

    if (/\bendif\b/i.test(suffix) || Boolean(elseSegment)) {
      expanded.push("endif");
    }
  }

  return expanded;
};

type FlowIfContext = {
  decisionId: string;
  thenLabel: string | null;
  elseLabel: string | null;
  thenEndNodeId: string | null;
  elseEndNodeId: string | null;
  onElseBranch: boolean;
};

const renderFlowNode = (node: FlowNode, indent = "  ") => {
  const escapedLabel = escapeMermaidText(node.label);

  if (node.shape === "diamond") {
    return `${indent}${node.id}{"${escapedLabel}"}`;
  }

  if (node.shape === "round") {
    return `${indent}${node.id}("${escapedLabel}")`;
  }

  if (node.shape === "stadium") {
    return `${indent}${node.id}(["${escapedLabel}"])`;
  }

  if (node.shape === "circle") {
    return `${indent}${node.id}(("${escapedLabel}"))`;
  }

  if (node.shape === "cylinder") {
    return `${indent}${node.id}[("${escapedLabel}")]`;
  }

  return `${indent}${node.id}["${escapedLabel}"]`;
};

const convertFlowchart = (lines: readonly string[]) => {
  let direction = "TD";
  const edges: string[] = [];
  const nodes = new Map<string, FlowNode>();
  const containers = new Map<string, FlowContainer>();
  const nodeContainerIds = new Map<string, string>();
  const aliases = new Map<string, string>();
  const fallbackIndex = { value: 1 };
  const ifStack: FlowIfContext[] = [];
  const containerStack: string[] = [];
  let mergeCounter = 1;
  let previousNodeId: string | null = null;

  const getCurrentContainerId = () =>
    containerStack.length ? containerStack[containerStack.length - 1] : null;

  const assignNodeToCurrentContainer = (nodeId: string) => {
    const containerId = getCurrentContainerId();
    if (containerId && !nodeContainerIds.has(nodeId)) {
      nodeContainerIds.set(nodeId, containerId);
    }
  };

  const resolveToken = (
    raw: string,
    shape: FlowNodeShape = "rect",
    labelOverride?: string,
  ) => {
    const cleaned = stripQuotes(raw);
    const alias = aliases.get(cleaned);
    if (alias) {
      const node = nodes.get(alias);
      if (node && node.shape === "rect" && shape !== "rect") {
        node.shape = shape;
      }
      assignNodeToCurrentContainer(alias);
      return alias;
    }

    const nodeId = normalizeFlowNode(
      cleaned,
      nodes,
      fallbackIndex,
      shape,
      labelOverride,
    );
    aliases.set(cleaned, nodeId);
    aliases.set(nodeId, nodeId);
    assignNodeToCurrentContainer(nodeId);
    return nodeId;
  };

  const registerContainer = (
    labelCandidate: string,
    aliasCandidate: string | undefined,
  ) => {
    const label = stripQuotes(labelCandidate)
      .replace(/^[[({|]+/, "")
      .replace(/[\])}|]+$/, "")
      .trim();
    const alias = stripQuotes(aliasCandidate || label);
    const containerId = VALID_IDENTIFIER_RE.test(alias)
      ? alias
      : toIdentifier(alias, "Group", fallbackIndex.value++);

    containers.set(containerId, {
      id: containerId,
      label: label || containerId,
      parentId: getCurrentContainerId(),
    });
    containerStack.push(containerId);
  };

  const getCurrentIfContext = () => ifStack[ifStack.length - 1] || null;

  const getConditionalBranchLabel = (fromNodeId: string) => {
    const context = getCurrentIfContext();
    if (!context || fromNodeId !== context.decisionId) {
      return null;
    }

    const label = context.onElseBranch ? context.elseLabel : context.thenLabel;
    return label?.trim() ? label.trim() : null;
  };

  const pushEdge = (
    fromNodeId: string,
    toNodeId: string,
    arrow: string = "-->",
    explicitLabel: string | null = null,
  ) => {
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
      return;
    }

    const label =
      explicitLabel && explicitLabel.trim()
        ? explicitLabel.trim()
        : getConditionalBranchLabel(fromNodeId);
    const labelSegment = label ? `|${escapeMermaidText(label)}|` : "";
    edges.push(`  ${fromNodeId} ${arrow}${labelSegment} ${toNodeId}`);
  };

  const captureBranchEndFromPrevious = () => {
    const context = getCurrentIfContext();
    if (!context || !previousNodeId || previousNodeId === context.decisionId) {
      return;
    }

    if (context.onElseBranch) {
      context.elseEndNodeId = previousNodeId;
    } else {
      context.thenEndNodeId = previousNodeId;
    }
  };

  for (const line of expandInlineConditionals(lines)) {
    const directionMatch = line.match(DIRECTION_RE);
    if (directionMatch) {
      const normalized = directionMatch[1].toLowerCase();
      if (normalized === "left to right") {
        direction = "LR";
      } else if (normalized === "right to left") {
        direction = "RL";
      } else if (normalized === "bottom to top") {
        direction = "BT";
      } else {
        direction = "TD";
      }
      continue;
    }

    if (line === "}") {
      if (containerStack.length) {
        containerStack.pop();
      }
      continue;
    }

    const containerMatch = line.match(
      /^(package|node|folder|frame|cloud|rectangle|database|component)\s+(.+?)(?:\s+as\s+(.+?))?\s*\{$/i,
    );
    if (containerMatch) {
      registerContainer(containerMatch[2], containerMatch[3]);
      previousNodeId = null;
      continue;
    }

    const declarationMatch = line.match(
      /^(actor|usecase|component|database|entity|node|artifact|rectangle|folder|frame|cloud|queue|participant|class|interface|enum|object|map|storage|file|card|boundary|control|collections)\s+(.+?)(?:\s+as\s+(.+))?$/i,
    );
    if (declarationMatch) {
      const shape = getFlowDeclarationShape(declarationMatch[1]);
      const rawLabel = stripQuotes(declarationMatch[2]);
      const rawAlias = stripQuotes(declarationMatch[3] || rawLabel);
      const alias = resolveToken(rawAlias, shape, rawLabel);
      aliases.set(rawLabel, alias);
      continue;
    }

    const shorthandNodeMatch = line.match(/^(\[[^\]]+\]|\([^)]+\))(?:\s+as\s+(.+))?$/i);
    if (shorthandNodeMatch) {
      const rawLabel = shorthandNodeMatch[1];
      const rawAlias = shorthandNodeMatch[2] || rawLabel;
      const shape = rawLabel.startsWith("(") ? "stadium" : "rect";
      const alias = resolveToken(rawAlias, shape, rawLabel);
      aliases.set(stripQuotes(rawLabel), alias);
      continue;
    }

    const decisionMatch = line.match(/^if\s*\((.+?)\)\s*then(?:\s*\((.+?)\))?$/i);
    if (decisionMatch) {
      const decisionId = resolveToken(decisionMatch[1], "diamond");
      if (previousNodeId && previousNodeId !== decisionId) {
        pushEdge(previousNodeId, decisionId);
      }

      ifStack.push({
        decisionId,
        thenLabel: decisionMatch[2]?.trim() || null,
        elseLabel: null,
        thenEndNodeId: null,
        elseEndNodeId: null,
        onElseBranch: false,
      });
      previousNodeId = decisionId;
      continue;
    }

    const elseMatch = line.match(/^else(?:\s*\((.+?)\))?$/i);
    if (elseMatch) {
      const context = getCurrentIfContext();
      if (!context) {
        continue;
      }

      captureBranchEndFromPrevious();

      if (!context.thenLabel) {
        context.thenLabel = "yes";
      }

      const elseLabel = elseMatch[1]?.trim();
      context.elseLabel = elseLabel || context.elseLabel || "no";
      context.onElseBranch = true;
      previousNodeId = context.decisionId;
      continue;
    }

    if (/^endif$/i.test(line)) {
      const context = ifStack.pop();
      if (!context) {
        continue;
      }

      if (previousNodeId && previousNodeId !== context.decisionId) {
        if (context.onElseBranch) {
          context.elseEndNodeId = previousNodeId;
        } else {
          context.thenEndNodeId = previousNodeId;
        }
      }

      const thenBranchEnd: string = context.thenEndNodeId ?? context.decisionId;
      const elseBranchEnd: string = context.elseEndNodeId ?? context.decisionId;

      if (thenBranchEnd === elseBranchEnd) {
        previousNodeId = thenBranchEnd;
        continue;
      }

      const mergeNodeId = resolveToken(`Merge ${mergeCounter++}`, "round");
      pushEdge(thenBranchEnd, mergeNodeId);
      pushEdge(elseBranchEnd, mergeNodeId);
      previousNodeId = mergeNodeId;
      continue;
    }

    const activityMatch = line.match(/^:(.+?)(?:;|:)$/);
    if (activityMatch) {
      const nodeId = resolveToken(activityMatch[1]);
      if (previousNodeId && previousNodeId !== nodeId) {
        pushEdge(previousNodeId, nodeId);
      }
      previousNodeId = nodeId;
      continue;
    }

    if (/^start$/i.test(line)) {
      const nodeId = resolveToken("Start", "round");
      if (previousNodeId && previousNodeId !== nodeId) {
        pushEdge(previousNodeId, nodeId);
      }
      previousNodeId = nodeId;
      continue;
    }

    if (/^(stop|end)$/i.test(line)) {
      const nodeId = resolveToken("End", "round");
      if (previousNodeId && previousNodeId !== nodeId) {
        pushEdge(previousNodeId, nodeId);
      }
      previousNodeId = nodeId;
      continue;
    }

    const arrowLine = parseArrowLine(line, FLOW_ARROWS);
    if (!arrowLine) {
      continue;
    }

    const isBidirectional =
      arrowLine.arrow.includes("<->") || arrowLine.arrow.includes("<-->");
    const shouldReverse =
      !isBidirectional &&
      arrowLine.arrow.startsWith("<") &&
      !arrowLine.arrow.startsWith("<|");

    const fromId = resolveToken(shouldReverse ? arrowLine.to : arrowLine.from);
    const toId = resolveToken(shouldReverse ? arrowLine.from : arrowLine.to);
    const arrow = toFlowArrow(arrowLine.arrow);
    pushEdge(fromId, toId, arrow, arrowLine.label || null);
    previousNodeId = toId;
  }

  if (!edges.length && !nodes.size) {
    throw new Error(
      "Could not parse PlantUML syntax. Supported now: sequence, class, ER/entity, state, mindmap, component/use-case, and flow/activity-style diagrams with relationship arrows.",
    );
  }

  const mermaidLines = [`flowchart ${direction}`];
  const childContainers = new Map<string | null, FlowContainer[]>();
  for (const container of containers.values()) {
    const siblings = childContainers.get(container.parentId) || [];
    siblings.push(container);
    childContainers.set(container.parentId, siblings);
  }

  const renderContainer = (container: FlowContainer, indent = "  ") => {
    const escapedLabel = escapeMermaidText(container.label);
    mermaidLines.push(`${indent}subgraph ${container.id}["${escapedLabel}"]`);

    for (const node of nodes.values()) {
      if (nodeContainerIds.get(node.id) === container.id) {
        mermaidLines.push(renderFlowNode(node, `${indent}  `));
      }
    }

    for (const childContainer of childContainers.get(container.id) || []) {
      renderContainer(childContainer, `${indent}  `);
    }

    mermaidLines.push(`${indent}end`);
  };

  for (const rootContainer of childContainers.get(null) || []) {
    renderContainer(rootContainer);
  }

  for (const node of nodes.values()) {
    if (!nodeContainerIds.has(node.id)) {
      mermaidLines.push(renderFlowNode(node));
    }
  }

  mermaidLines.push(...edges);
  return mermaidLines.join("\n");
};

export const convertPlantUmlToMermaid = (definition: string) => {
  const lines = normalizePlantUml(definition);

  if (!lines.length) {
    throw new PlantUmlConversionError("PlantUML definition is empty.", {
      lineNumber: null,
      lineText: "",
      diagramType: "flow/activity",
      hint: "Add a PlantUML diagram between @startuml and @enduml.",
    });
  }

  try {
    if (isLikelyEr(lines)) {
      return convertErDiagram(lines);
    }

    if (isLikelyMindmap(lines)) {
      return convertMindmap(lines);
    }

    if (isLikelyState(lines)) {
      return convertStateDiagram(lines);
    }

    const isComponentOrUseCase = isLikelyComponentOrUseCase(lines);

    if (!isComponentOrUseCase && isLikelySequence(lines)) {
      return convertSequence(lines);
    }

    if (!isComponentOrUseCase && isLikelyClass(lines)) {
      return convertClassDiagram(lines);
    }

    return convertFlowchart(lines);
  } catch (error) {
    const diagramType = isLikelyEr(lines)
      ? "entity/er"
      : isLikelyMindmap(lines)
      ? "mindmap"
      : isLikelyState(lines)
      ? "state"
      : isLikelyComponentOrUseCase(lines)
      ? "component/use case"
      : isLikelyClass(lines)
      ? "class"
      : isLikelySequence(lines)
      ? "sequence"
      : "flow/activity";

    throw toPlantUmlConversionError(error, definition, lines, diagramType);
  }
};
