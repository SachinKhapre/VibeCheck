import type { ActivityEntry } from '../state/types';

/**
 * The collaboration made visible. Agent tool calls and your own clicks land in the
 * same log because both go through the same reducer — so the page can never claim
 * something happened that the board doesn't reflect.
 */
export function ActivityRail({ activity }: { activity: ActivityEntry[] }) {
  if (activity.length === 0) return null;

  return (
    <section className="activity">
      <h2>
        activity
        <span className="count">{activity.length}</span>
      </h2>
      <ol>
        {activity.map((e) => (
          <li key={e.id} className={e.actor}>
            <span className="who">{e.actor === 'agent' ? 'agent' : 'you'}</span>
            <div className="what">
              <p className="summary">{e.summary}</p>
              {e.tool && <code className="tool">{e.tool}</code>}
              {e.effect && <p className="effect">{e.effect}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
