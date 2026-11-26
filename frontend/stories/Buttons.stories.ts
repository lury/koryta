import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { mdiPencil, mdiShareVariant, mdiTrashCanOutline } from "@mdi/js";
import IconAction from "../app/components/button/IconAction.vue";

const meta: Meta<typeof IconAction> = {
  title: "Komponenty/IconAction",
  component: IconAction,
  args: { icon: mdiPencil, label: "Zaproponuj zmianę" },
};
export default meta;
type Story = StoryObj<typeof IconAction>;

export const Jeden: Story = {};

export const Rzad: Story = {
  render: () => ({
    components: { IconAction },
    setup: () => ({ mdiPencil, mdiShareVariant, mdiTrashCanOutline }),
    template: `<div class="d-flex ga-2">
      <IconAction :icon="mdiPencil" label="Zaproponuj zmianę" />
      <IconAction :icon="mdiShareVariant" label="Udostępnij" tooltip="Skopiuj link do tej strony" />
      <IconAction :icon="mdiTrashCanOutline" label="Usuń" color="ink-danger" />
    </div>`,
  }),
};
