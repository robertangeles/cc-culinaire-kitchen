/**
 * @module components/compliance/OtherDocumentTypeInput
 *
 * The free-text field shown when "Other" is picked from a document-type
 * dropdown — shared by DocumentUploadForm and RolesManager so the two
 * escape hatches can't drift.
 */

export function OtherDocumentTypeInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Name the document"
      aria-label="Document name"
      maxLength={40}
      className={className}
    />
  );
}
