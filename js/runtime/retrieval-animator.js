import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";

/**
 * Retrieval Animator — coordinates visual effects during the 13-step sequence.
 * Listens to retrieval events and publishes canvas commands.
 * The actual rendering is handled by graph-canvas.js.
 */
class RetrievalAnimator {
	#dispose = [];
	#running = false;
	#currentStep = 0;

	initialize() {
		this.#dispose.push(
			subscribe(EVENTS.CAR_RETRIEVAL_STARTED, () => {
				this.#running = true;
				this.#currentStep = 0;
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_RETRIEVAL_STEP_STARTED, ({ payload }) => {
				this.#currentStep = payload?.step ?? 0;
				this.#onStepStarted(this.#currentStep, payload?.name ?? "");
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_RETRIEVAL_STEP_COMPLETED, ({ payload }) => {
				this.#onStepCompleted(payload?.step ?? 0);
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_RETRIEVAL_COMPLETED, () => {
				this.#running = false;
				this.#currentStep = 0;
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_RETRIEVAL_FAILED, () => {
				this.#running = false;
				this.#currentStep = 0;
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.CAR_RETRIEVAL_RESET, () => {
				this.#running = false;
				this.#currentStep = 0;
			}),
		);
	}

	dispose() {
		this.#dispose.forEach((run) => run());
		this.#dispose = [];
	}

	get isRunning() {
		return this.#running;
	}

	get currentStep() {
		return this.#currentStep;
	}

	/* ── Step-specific visual commands ── */

	#onStepStarted(step, _name) {
		switch (step) {
			case 1:
				// Session Primer: warm glow on recent chunks
				// Handled by canvas dimming non-active nodes
				break;

			case 2:
				// Context Construction: query node appears at front plane
				// The canvas would create a temporary query visualization
				break;

			case 3:
				// Question Decomposition: fan-out animation
				break;

			case 5:
				// Multi-Query Retrieval: particle beams into graph
				break;

			case 6:
				// Cluster Formation: chunks drift together
				break;

			case 8:
				// Tiered Retrieval: camera pulls back
				publish(EVENTS.CAR_CANVAS_CAMERA_HOME, {
					origin: "retrieval-animator",
				});
				break;

			case 9:
				// Interference Check: red pulses between contradictions
				break;

			case 12:
				// Synthesis: all activated chunks pulse
				break;

			case 13:
				// Post-Retrieval Update: flash re-indexed chunks
				break;
		}
	}

	#onStepCompleted(_step) {
		// Visual transitions between steps handled by the animation loop
	}
}

export const retrievalAnimator = new RetrievalAnimator();
