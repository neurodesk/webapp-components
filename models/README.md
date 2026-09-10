# Neurodesk webapp scientific assets

Large browser-inference assets for the composite Neurodesk webapps site are stored
in the Hugging Face Storage Bucket `neurodeskorg/webapps-bucket`, not in Git.

The JSON manifests in this directory are the source of truth for filenames, byte
sizes, SHA-256 checksums, source provenance, licences, and preprocessing contracts.
Runtime URLs use source commit IDs in bucket prefixes so published objects are not
overwritten in place.

Current folders:

- `musclemap/`: six ONNX segmentation models imported from
  `neurodesk/musclemap-webapp@8b5012b`.
- `vesselboost/`: four VesselBoost models plus SynthStrip imported from
  `neurodesk/vesselboost-webapp@6ba7d07`.
- `seedseg/`: four consensus models migrated from the OSF objects recorded in
  `seedseg.manifest.json`.
- `browserqc/`: the Brainchop model, colour map, and example T1 image.
- `deface/`: the MindGrab weights, templates, and example T1 image.
- `niimath/`: eight example images shared by NiiMath and SynthSR.
- `syncro/`: the browser SynthStrip graph and the licensed MNI template.
- `synthsr/`: the validated SynthSR v2 browser graph and attribution files.

Application and model licences are independent. `NOASSERTION` in a manifest means
the upstream project has not yet supplied machine-readable redistribution terms.
