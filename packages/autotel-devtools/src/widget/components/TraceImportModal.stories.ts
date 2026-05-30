import type { Meta, StoryObj } from '@storybook/svelte-vite';
import { expect, userEvent, within } from 'storybook/test';
import TraceImportModal from './TraceImportModal.svelte';

type ImportOutcome = { imported: number; errors: string[]; warnings: string[] };

const meta = {
  title: 'Views/TraceImportModal',
  component: TraceImportModal,
  parameters: { layout: 'fullscreen' },
  args: {
    onclose: () => {},
    onimport: async () => ({ imported: 1, errors: [], warnings: [] }),
  },
} satisfies Meta<typeof TraceImportModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleFile = () =>
  new File(['{"traces":[]}'], 'traces.json', { type: 'application/json' });

const outcome = (o: ImportOutcome) => async () => o;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('dialog', { name: 'Import traces' }),
    ).toBeInTheDocument();
    await expect(canvas.getByText('Choose file')).toBeInTheDocument();
    // Confirm is disabled until a file is chosen.
    await expect(
      canvas.getByRole('button', { name: 'Confirm Import' }),
    ).toBeDisabled();
  },
};

export const ImportsSuccessfully: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvasElement.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, sampleFile());
    await expect(canvas.getByText('traces.json')).toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Confirm Import' }),
    );
    await expect(
      await canvas.findByText(/Successfully imported 1 trace/),
    ).toBeInTheDocument();
  },
};

export const ShowsImportErrors: Story = {
  args: {
    onimport: outcome({
      imported: 0,
      errors: ['Invalid span at traces[0]'],
      warnings: [],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvasElement.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await userEvent.upload(input, sampleFile());
    await userEvent.click(
      canvas.getByRole('button', { name: 'Confirm Import' }),
    );
    await expect(
      await canvas.findByText(/Invalid span at traces\[0\]/),
    ).toBeInTheDocument();
  },
};
