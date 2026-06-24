import type { ProjectTreeNode } from "../types/ui";

export const mockProjectTree: ProjectTreeNode[] = [
  {
    id: "content",
    name: "Content",
    type: "Folder",
    children: [
      {
        id: "content-maps",
        name: "Maps",
        type: "Folder",
        children: [
          {
            id: "map-lyra-frontend",
            name: "L_LyraFrontEnd.umap",
            type: "Map",
          },
        ],
      },
      {
        id: "content-characters",
        name: "Characters",
        type: "Folder",
        children: [
          {
            id: "asset-hero-character",
            name: "B_HeroCharacter.uasset",
            type: "Blueprint",
          },
        ],
      },
      {
        id: "content-materials",
        name: "Materials",
        type: "Folder",
        children: [
          {
            id: "mat-ui-hologram",
            name: "M_UI_Hologram.uasset",
            type: "Material",
          },
        ],
      },
    ],
  },
  {
    id: "config",
    name: "Config",
    type: "Folder",
    children: [
      {
        id: "config-default-game",
        name: "DefaultGame.ini",
        type: "Config",
      },
    ],
  },
];
