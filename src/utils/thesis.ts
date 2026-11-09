import {
  bold,
  ContainerBuilder,
  heading,
  HeadingLevel,
  SeparatorSpacingSize,
} from 'discord.js';

import { truncateString } from './components.js';

export type ThesisPerson = {
  label: string;
  name: string;
};

type CreateThesisContainerParams = {
  accentColor?: number | undefined;
  content: string;
  identity: string;
  people: ThesisPerson[];
  title: string;
  typeLabel: string;
};

export const createThesisContainer = ({
  accentColor,
  content,
  identity,
  people,
  title,
  typeLabel,
}: CreateThesisContainerParams): ContainerBuilder => {
  const container = new ContainerBuilder();

  if (accentColor !== undefined) {
    container.setAccentColor(accentColor);
  }

  container
    .addTextDisplayComponents((textDisplayComponent) =>
      textDisplayComponent.setContent(`-# ${typeLabel}\n${bold(identity)}`),
    )
    .addSeparatorComponents((separatorComponent) =>
      separatorComponent.setSpacing(SeparatorSpacingSize.Large),
    )
    .addTextDisplayComponents((textDisplayComponent) =>
      textDisplayComponent.setContent(heading(title, HeadingLevel.Three)),
    )
    .addSeparatorComponents((separatorComponent) =>
      separatorComponent
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(false),
    )
    .addTextDisplayComponents((textDisplayComponent) =>
      textDisplayComponent.setContent(
        content === '?' ? 'Нема опис.' : truncateString(content),
      ),
    )
    .addSeparatorComponents((separatorComponent) =>
      separatorComponent.setSpacing(SeparatorSpacingSize.Large),
    );

  for (const person of people) {
    const label = bold(`${person.label}:`);

    container.addTextDisplayComponents((textDisplayComponent) =>
      textDisplayComponent.setContent(`${label} ${person.name}`),
    );
  }

  return container;
};
