import { useState, useRef, useEffect, useDeferredValue } from "react";

import { EDITOR_LS_KEYS, debounce, isDevEnv } from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { useApp } from "../App";
import { ArrowRightIcon } from "../icons";
import { EditorLocalStorage } from "../../data/EditorLocalStorage";
import { t } from "../../i18n";

import { useUIAppState } from "../../context/ui-appState";

import { TTDDialogInput } from "./TTDDialogInput";
import { TTDDialogOutput } from "./TTDDialogOutput";
import { TTDDialogPanel } from "./TTDDialogPanel";
import { TTDDialogPanels } from "./TTDDialogPanels";
import { TTDDialogSubmitShortcut } from "./TTDDialogSubmitShortcut";
import {
  convertMermaidToExcalidraw,
  insertToEditor,
  resetPreview,
} from "./common";
import {
  convertPlantUmlToMermaid,
  getPlantUmlDiagnostic,
} from "./utils/plantumlToMermaid";

import type { BinaryFiles } from "../../types";
import type { MermaidToExcalidrawLibProps } from "./types";

const PLANTUML_EXAMPLE =
  "@startuml\nactor User\nparticipant App\nparticipant API\nUser -> App: Save scene\nApp -> API: Upload scene payload\nAPI --> App: Save ok\nApp --> User: Success toast\n@enduml";

const PLANTUML_SNIPPETS = [
  {
    label: "Sequence",
    value:
      "@startuml\nactor User\nparticipant App\nUser -> App: Open canvas\nApp --> User: Canvas loaded\n@enduml",
  },
  {
    label: "Class",
    value:
      "@startuml\nclass Canvas\nclass Library\nCanvas --> Library : uses\n@enduml",
  },
  {
    label: "ER",
    value:
      "@startuml\nentity User {\n* id : int <<PK>>\n--\nname : string\n}\nentity Canvas {\n* id : int <<PK>>\nuser_id : int <<FK>>\ntitle : string\n}\nUser ||--o{ Canvas : owns\n@enduml",
  },
  {
    label: "Use case",
    value:
      '@startuml\nleft to right direction\nactor User\nusecase "Open canvas" as Open\nusecase "Export backup" as Backup\nUser --> Open\nUser --> Backup\n@enduml',
  },
  {
    label: "Component",
    value:
      '@startuml\npackage "Tablet app" {\ncomponent "Canvas UI" as UI\ncomponent "Storage bridge" as Bridge\ndatabase "Documents/Excalidraw" as Docs\nUI --> Bridge : save/open\nBridge --> Docs : files\n}\n@enduml',
  },
  {
    label: "State",
    value:
      "@startuml\n[*] --> Draft\nDraft --> Saved : save\nSaved --> Draft : edit\n@enduml",
  },
  {
    label: "Mind map",
    value:
      "@startmindmap\n* Project\n** Canvases\n** Libraries\n** Backups\n@endmindmap",
  },
  {
    label: "Flow",
    value:
      "@startuml\nstart\n:Import file;\nif (Valid?) then (yes)\n:Open canvas;\nelse (no)\n:Show error;\nendif\nstop\n@enduml",
  },
] as const;

const savePlantUmlDataToStorage = (definition: string) => {
  EditorLocalStorage.set(EDITOR_LS_KEYS.PLANTUML_TO_EXCALIDRAW, definition);
};

const debouncedSavePlantUmlDefinition = debounce(savePlantUmlDataToStorage, 300);

const PlantUMLToExcalidraw = ({
  mermaidToExcalidrawLib,
  isActive,
}: {
  mermaidToExcalidrawLib: MermaidToExcalidrawLibProps;
  isActive?: boolean;
}) => {
  const [text, setText] = useState(
    () =>
      EditorLocalStorage.get<string>(EDITOR_LS_KEYS.PLANTUML_TO_EXCALIDRAW) ||
      PLANTUML_EXAMPLE,
  );
  const deferredText = useDeferredValue(text);
  const [error, setError] = useState<Error | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const data = useRef<{
    elements: readonly NonDeletedExcalidrawElement[];
    files: BinaryFiles | null;
  }>({ elements: [], files: null });

  const app = useApp();
  const { theme } = useUIAppState();
  const diagnostic = getPlantUmlDiagnostic(error);

  useEffect(() => {
    const doRender = async () => {
      try {
        if (!deferredText.trim()) {
          resetPreview({ canvasRef, setError });
          return;
        }

        let mermaidDefinition: string;
        try {
          mermaidDefinition = convertPlantUmlToMermaid(deferredText);
        } catch (conversionError) {
          const wrappedError =
            conversionError instanceof Error
              ? conversionError
              : new Error("Invalid PlantUML definition");
          resetPreview({ canvasRef, setError });
          setError(wrappedError);
          return;
        }

        const result = await convertMermaidToExcalidraw({
          canvasRef,
          data,
          mermaidToExcalidrawLib,
          setError,
          mermaidDefinition,
          theme,
        });

        if (!result.success) {
          setError(result.error ?? new Error("Invalid PlantUML definition"));
        }
      } catch (err) {
        if (isDevEnv()) {
          console.error("Failed to parse PlantUML definition", err);
        }
      }
    };

    if (isActive) {
      doRender();
      debouncedSavePlantUmlDefinition(deferredText);
    }
  }, [deferredText, mermaidToExcalidrawLib, isActive, theme]);

  useEffect(
    () => () => {
      debouncedSavePlantUmlDefinition.flush();
    },
    [],
  );

  const onInsertToEditor = () => {
    insertToEditor({
      app,
      data,
    });
    savePlantUmlDataToStorage(text);
  };

  return (
    <>
      <div className="ttd-dialog-desc">{t("plantuml.description")}</div>
      <div className="ttd-dialog-snippets" aria-label="PlantUML examples">
        {PLANTUML_SNIPPETS.map((snippet) => (
          <button
            key={snippet.label}
            className="ttd-dialog-snippet-button"
            type="button"
            onClick={() => {
              setText(snippet.value);
              setError(null);
            }}
          >
            {snippet.label}
          </button>
        ))}
      </div>
      <TTDDialogPanels>
        <TTDDialogPanel>
          <TTDDialogInput
            input={text}
            placeholder={t("plantuml.inputPlaceholder")}
            onChange={(value) => setText(value)}
            errorLine={diagnostic?.lineNumber ?? null}
            onKeyboardSubmit={() => {
              onInsertToEditor();
            }}
          />
          {diagnostic ? (
            <div className="ttd-dialog-plantuml-diagnostic">
              <strong>
                {diagnostic.diagramType} diagram
                {diagnostic.lineNumber ? `, line ${diagnostic.lineNumber}` : ""}
              </strong>
              {diagnostic.lineText ? <code>{diagnostic.lineText.trim()}</code> : null}
              <span>{diagnostic.hint}</span>
            </div>
          ) : null}
        </TTDDialogPanel>
        <TTDDialogPanel
          panelActions={[
            {
              action: () => {
                onInsertToEditor();
              },
              label: t("plantuml.button"),
              icon: ArrowRightIcon,
              variant: "button",
            },
          ]}
          renderSubmitShortcut={() => <TTDDialogSubmitShortcut />}
        >
          <TTDDialogOutput
            canvasRef={canvasRef}
            loaded={mermaidToExcalidrawLib.loaded}
            error={error}
            sourceText={text}
          />
        </TTDDialogPanel>
      </TTDDialogPanels>
    </>
  );
};

export default PlantUMLToExcalidraw;
