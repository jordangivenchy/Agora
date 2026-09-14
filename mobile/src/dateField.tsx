/* The web preview has no system date picker; the New room sheet shows its
   preset times instead. The phone build's picker is dateField.native.tsx. */
export const hasDatePicker = false;

export function DateTimeField(_props: { value: Date; minimumDate: Date; onChange: (d: Date) => void }) {
  return null;
}
