const SHORTCUT_ROWS: [string, string][] = [
  ["Focus quick search", "Ctrl + K"],
  ["Collapse or expand sidebar", "Ctrl + B"],
  ["Toggle Editor Mode", "Ctrl + E"],
  ["Open or close Settings", "Ctrl + ,"],
  ["Play or pause video", "Space / K"],
  ["Skip back 5 seconds", "J / Left Arrow"],
  ["Skip forward 5 seconds", "L / Right Arrow"],
  ["Step back 1 frame", ", (Comma)"],
  ["Step forward 1 frame", ". (Period)"],
  ["Previous / next segment (Editor)", "[ / ]"],
  ["Split segment at playhead (Editor)", "S"],
  ["Select all segments (Editor)", "Ctrl + A"],
  ["Undo edit (Editor)", "Ctrl + Z"],
  ["Redo edit (Editor)", "Ctrl + Shift + Z / Ctrl + Y"],
  ["Save project (Editor)", "Ctrl + S"],
  ["Save project as (Editor)", "Ctrl + Shift + S"],
  ["Open saved project (Editor)", "Ctrl + O"],
  ["Set trim start / end", "I / O"],
  ["Toggle loop", "R"],
  ["Add moment marker (Player)", "M"],
  ["Mute or unmute audio", "U"],
  ["Toggle Stretch 16:9 (Player)", "S"],
  ["Toggle fullscreen", "F"],
  ["Add clip to Collection", "C"],
  ["Toggle Favorite", "Shift + F"],
  ["Delete active clip", "Delete"],
  ["Previous / next clip in queue", "Shift + P / Shift + N"],
  ["Close popover or return", "Escape"],
];

export function ShortcutsTab() {
  return (
    <section aria-labelledby="settings-shortcuts-heading">
      <h1
        id="settings-shortcuts-heading"
        className="text-[18px] font-semibold text-[var(--text-primary)]"
      >
        Keyboard Shortcuts
      </h1>
      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
        Active navigation, playback, and trimming shortcuts.
      </p>

      <div className="mt-5 overflow-hidden rounded-[12px] border border-[var(--border-hairline)] bg-[var(--surface-card)] shadow-[var(--border-card-specular),var(--shadow-card-rest)]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border-hairline)] bg-slate-900/[0.035]">
              <th className="px-4 py-2.5 font-semibold text-[var(--text-secondary)]">
                Action
              </th>
              <th className="px-4 py-2.5 text-right font-semibold text-[var(--text-secondary)]">
                Shortcut
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_ROWS.map(([action, keyLabel]) => (
              <tr
                key={action}
                className="border-b border-[var(--border-hairline)] last:border-b-0"
              >
                <td className="px-4 py-2.5 text-[var(--text-primary)]">{action}</td>
                <td className="px-4 py-2.5 text-right">
                  <kbd className="font-mono-tabular rounded-[4px] border border-[var(--border-hairline)] bg-white/80 px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
                    {keyLabel}
                  </kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
