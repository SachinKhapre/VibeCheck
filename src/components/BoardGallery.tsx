import type { RecordedBoard } from '../fixtures';

interface Props {
  boards: RecordedBoard[];
  onOpen: (board: RecordedBoard) => void;
}

/**
 * Recorded boards, on the home page.
 *
 * These are real gathers that already happened, bundled with the app — so a cold
 * visitor gets a full board instantly, with no key, no network and no SerpApi credit.
 * Each card says the date it was gathered, because a recorded board must never read
 * as a live one.
 */
export function BoardGallery({ boards, onOpen }: Props) {
  if (boards.length === 0) return null;

  return (
    <section className="gallery">
      <header className="gallery-head">
        <h2>recorded boards</h2>
        <p>Already gathered, already judged by nobody. Open one and start rejecting sources.</p>
      </header>

      <div className="gallery-grid">
        {boards.map((board, i) => {
          const sites = [...new Set(board.sources.map((s) => s.site))].slice(0, 3);
          const top = board.claims[0];
          return (
            <button
              key={board.slug}
              className="board-card"
              onClick={() => onOpen(board)}
              style={{ ['--stagger' as string]: `${i * 70}ms` }}
            >
              <span className="board-topic">{board.topic}</span>
              <span className="board-blurb">{board.blurb}</span>

              {top && (
                <span className="board-top">
                  <span className="quote" aria-hidden="true">
                    “
                  </span>
                  {top.text}
                </span>
              )}

              <span className="board-foot">
                <span className="board-stats">
                  <b>{board.claims.length}</b> claims
                  <i />
                  <b>{board.sources.length}</b> threads
                </span>
                <span className="board-date">{board.recordedAt}</span>
              </span>

              <span className="board-sites">{sites.join(' · ')}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
