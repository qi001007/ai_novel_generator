/**
 * A horizontal scrollbar that never enters the layout.
 *
 * 第十轮批注 6 asked for a bar that appears on hover. 第十二批批注 3 then complained
 * the tabs collapsed from 39px to 30px the moment it did - a native scrollbar either
 * takes its 10px or is not there at all. 第十四批批注 4: deleting it was not the
 * answer either - he wanted both properties. So this is the third option: an
 * absolutely positioned thumb over the strip's bottom edge, sized from the
 * scroller's own geometry, faded in by the strip's :hover, draggable, and unable to
 * move a single tab because nothing about it is in the flow.
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

type Geo = { room: number; width: number; left: number; track: number; trackLeft: number };

export default function HScrollThumb({
  scroller,
  revision,
}: {
  scroller: RefObject<HTMLElement | null>;
  /** anything that changes the scrolled content; re-measures when it changes */
  revision: string | number;
}) {
  const [geo, setGeo] = useState<Geo>({ room: 0, width: 0, left: 0, track: 0, trackLeft: 0 });
  const [dragging, setDragging] = useState(false);
  const grabRef = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const room = el.scrollWidth - el.clientWidth;
      const ratio = el.clientWidth / Math.max(1, el.scrollWidth);
      const width = Math.max(28, Math.round(el.clientWidth * ratio));
      const travel = Math.max(1, el.clientWidth - width);
      setGeo({
        room,
        width,
        left: Math.round((room > 0 ? el.scrollLeft / room : 0) * travel),
        track: el.clientWidth,
        trackLeft: el.offsetLeft,
      });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // jsdom has no ResizeObserver; the scroll listener plus the revision key cover
    // what the tests need, and a browser without it simply loses the resize signal.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer) observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [scroller, revision]);

  if (geo.room <= 0) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const el = scroller.current;
    if (!el) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    grabRef.current = event.clientX - (el.getBoundingClientRect().left + geo.left);
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const el = scroller.current;
    if (!el || !dragging) return;
    const travel = Math.max(1, el.clientWidth - geo.width);
    const at = event.clientX - el.getBoundingClientRect().left - grabRef.current;
    el.scrollLeft = (Math.min(travel, Math.max(0, at)) / travel) * geo.room;
  };

  return (
    <div
      className={`h-scroll ${dragging ? "dragging" : ""}`}
      style={{ left: geo.trackLeft, width: geo.track }}
      aria-hidden="true"
    >
      <i
        className="h-scroll-thumb"
        style={{ left: geo.left, width: geo.width }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      />
    </div>
  );
}
