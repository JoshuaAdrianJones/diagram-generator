# Model fidelity and visual decisions

[Joseph D. Novak and Alberto J. Cañas, The Theory Underlying Concept Maps and How to Construct and Use Them](https://cmap.ihmc.us/publications/researchpapers/theoryunderlyingconceptmaps.pdf) describe concept maps around a focus question, concepts, and linking phrases that form propositions. Apply those ideas by preserving the question and supplied claims. Use hierarchy when the model contains it. A feedback loop or associative map need not become a hierarchy. Do not invent cross-links merely because the paper encourages searching for them.

[Tamara Munzner, A Nested Model for Visualization Design and Validation](https://www.cs.ubc.ca/labs/imager/tr/2009/NestedModel/NestedModel.pdf) separates problems in domain understanding, data/task abstraction, visual encoding/interaction, and algorithms. For this workflow, check content fidelity before judging geometry. A readable arrow that states the wrong relationship is still wrong. Geometry diagnostics help evaluate placement, but actual screenshots reveal whether text, routes, and groups communicate the intended model.

Use `flow` for ordered or hierarchical relationships, `radial` for a central concept and its related concepts, `cycle` for a feedback loop, and `manual` for explicit geometry. These are initial placement strategies. Version one does not implement specialised matrices, roadmaps, opportunity trees, or an interactive editor.

Prefer a few pastel accents with dark text on white. Keep typography readable. The default uses Bangers for comic headings and Caveat for body labels. These are bundled licensed fonts, not a claim to reproduce a particular Miro font. `clean` changes stroke roughness separately from font selection.

When a model is dense, inspect readable crops. Report crowding and suggest an alternate view as a possible next task. Keep all supplied content in the current map unless the user authorises a scope change.
