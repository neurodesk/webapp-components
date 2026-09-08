#!/usr/bin/env python3
"""Export the pinned SynthSR Keras model as a simple NCDHW ONNX graph.

No retraining. Preserve Conv->ELU->BatchNorm order and pre-BN skip connections.
Avoid exporter-generated transposes/shape subgraphs: Conv, ELU, BatchNormalization,
MaxPool, Resize(nearest/asymmetric/floor), Add, Identity only after optimization.
"""
import os
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '3')
os.environ.setdefault('TF_NUM_INTRAOP_THREADS', '2')
os.environ.setdefault('TF_NUM_INTEROP_THREADS', '1')
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
import onnx
from onnx import helper as oh, numpy_helper as nh, TensorProto as T

SOURCE_COMMIT = '04ab5548f4609c2b44ca51b3f4bc319b585dafa7'

def export(model):
    nodes, weights, names = [], [], {}
    def constant(name, array):
        weights.append(nh.from_array(np.asarray(array), name)); return name
    def emit(op, inputs, name, **attrs):
        nodes.append(oh.make_node(op, inputs, [name], name=name, **attrs)); return name
    for layer in model.layers:
        kind, name = type(layer).__name__, layer.name
        if kind == 'InputLayer':
            names[id(layer.output)] = 'input'; continue
        incoming = layer.input if isinstance(layer.input, list) else [layer.input]
        inputs = [names[id(t)] for t in incoming]
        if kind == 'Conv3D':
            kernel, bias = layer.get_weights()
            w = constant(name+'_W', kernel.transpose(4,3,0,1,2))
            b = constant(name+'_B', bias)
            output = emit('Conv', inputs+[w,b], name+'_conv', kernel_shape=list(layer.kernel_size),
                          pads=[k//2 for k in layer.kernel_size]*2, strides=[1,1,1])
            activation = layer.get_config()['activation']
            if activation != 'linear':
                if activation != 'elu': raise ValueError(activation)
                output = emit('Elu', [output], name, alpha=1.)
        elif kind == 'BatchNormalization':
            params = [constant(name+'_'+str(i), a) for i,a in enumerate(layer.get_weights())]
            output = emit('BatchNormalization', inputs+params, name, epsilon=layer.epsilon)
        elif kind == 'MaxPooling3D':
            output = emit('MaxPool', inputs, name, kernel_shape=list(layer.pool_size), strides=list(layer.strides), auto_pad='SAME_UPPER')
        elif kind == 'UpSampling3D':
            scales = constant(name+'_scales', np.array([1,1,*layer.size],np.float32))
            output = emit('Resize', inputs+['',scales], name, mode='nearest', coordinate_transformation_mode='asymmetric', nearest_mode='floor')
        elif kind == 'Concatenate': output = emit('Concat', inputs, name, axis=1)
        elif kind == 'Activation' and layer.get_config()['activation'] == 'linear': output = emit('Identity', inputs, name)
        else: raise ValueError(f'Unsupported layer: {kind} {name}')
        names[id(layer.output)] = output
    nodes.append(oh.make_node('Identity', [names[id(model.output)]], ['output']))
    shape=[1,1,'x','y','z']
    graph=oh.make_graph(nodes,'SynthSR-v2', [oh.make_tensor_value_info('input',T.FLOAT,shape)], [oh.make_tensor_value_info('output',T.FLOAT,shape)], weights)
    result=oh.make_model(graph,opset_imports=[oh.make_opsetid('',17)],producer_name='neurodesk-synthsr')
    result.ir_version=9
    oh.set_model_props(result, {'source':f'neurolabusc/py_synthsr@{SOURCE_COMMIT}', 'checkpoint':'synthsr_v20_230130.h5','layout':'NCDHW; spatial axes RAS; z fastest','license':'Apache-2.0'})
    onnx.checker.check_model(result)
    return result

def split_concat_convolutions(model):
    """Conv(concat(a,b), W) = Conv(a, Wa) + Conv(b, Wb).

    Avoid the decoder's 72-channel full-resolution concatenation, which exceeds
    2 GiB on ordinary brain volumes. This is an algebraic rewrite, not tiling.
    The original graph remains the reference for numerical validation.
    """
    arrays={w.name:nh.to_array(w) for w in model.graph.initializer}
    concats={n.output[0]:n for n in model.graph.node if n.op_type=='Concat'}
    removed=set(); rewritten=[]
    for node in model.graph.node:
        if node.op_type=='Conv' and node.input[0] in concats:
            cat=concats[node.input[0]];w=arrays[node.input[1]]
            assert len(cat.input)==2 and w.shape[1]==3*w.shape[0]
            split=w.shape[0];removed.add(cat.output[0])
            attrs={a.name:oh.get_attribute_value(a) for a in node.attribute}
            for i,kernel in enumerate([w[:,:split],w[:,split:]]):
                name=node.name+f'_part{i}';weight=name+'_W'
                model.graph.initializer.append(nh.from_array(kernel.copy(),weight))
                inputs=[cat.input[i],weight]+([node.input[2]] if i==0 else [])
                rewritten.append(oh.make_node('Conv',inputs,[name],name=name,**attrs))
            rewritten.append(oh.make_node('Add',[node.name+'_part0',node.name+'_part1'],list(node.output),name=node.name+'_sum'))
        else: rewritten.append(node)
    del model.graph.node[:]
    model.graph.node.extend(n for n in rewritten if not (n.op_type=='Concat' and n.output[0] in removed))
    used={i for n in model.graph.node for i in n.input}
    keep=[w for w in model.graph.initializer if w.name in used]
    del model.graph.initializer[:];model.graph.initializer.extend(keep)
    onnx.checker.check_model(model)
    return model

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--checkpoint',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    args=p.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != 'f90e7e5589acb6f9c97861a399d4c6c8c5fedf0a9fc304883290eec20603c79b': raise ValueError('Source differs from the pinned SynthSR reference')
    if hashlib.sha256(args.checkpoint.read_bytes()).hexdigest() != 'a472f776e7b33b5ea6e10c801f55fee488f1477a208b3e6998dc1aec1d9c5f8b': raise ValueError('Checkpoint differs from the pinned SynthSR v2 weights')
    spec=importlib.util.spec_from_file_location('synthsr_reference',args.source)
    reference=importlib.util.module_from_spec(spec);spec.loader.exec_module(reference)
    model=reference.build_model(str(args.checkpoint))
    exported=split_concat_convolutions(export(model));path=args.out/'synthsr-v2.onnx';onnx.save(exported,path)
    import onnxruntime as ort
    options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
    session=ort.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider'])
    rng=np.random.default_rng(42)
    validation=[]
    for shape in [(32,32,32),(32,32,64)]:
        x=rng.uniform(0,1,(1,*shape,1)).astype(np.float32)
        expected=model(x,training=False).numpy()
        actual=session.run(None,{'input':x.transpose(0,4,1,2,3)})[0].transpose(0,2,3,4,1)
        error=np.abs(expected-actual)
        np.testing.assert_allclose(actual,expected,atol=2e-5,rtol=2e-4)
        validation.append({'shape':shape,'max_abs_error':float(error.max()),'mean_abs_error':float(error.mean())})
    report={'checkpoint_sha256':hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),'onnx_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'onnx_bytes':path.stat().st_size,'validation':validation}
    (args.out/'conversion.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    # Tiny Conv3D + pooling + 3D upsampling graph for real browser EP testing.
    w=nh.from_array(np.ones((1,1,3,3,3),np.float32),'w')
    scales=nh.from_array(np.array([1,1,2,2,2],np.float32),'scales')
    probe=oh.make_model(oh.make_graph([
        oh.make_node('Conv',['input','w'],['conv'],pads=[1]*6),
        oh.make_node('MaxPool',['conv'],['pool'],kernel_shape=[2]*3,strides=[2]*3),
        oh.make_node('Resize',['pool','','scales'],['output'],mode='nearest',coordinate_transformation_mode='asymmetric',nearest_mode='floor')
    ],'conv3d-probe',[oh.make_tensor_value_info('input',T.FLOAT,[1,1,4,4,4])],[oh.make_tensor_value_info('output',T.FLOAT,[1,1,4,4,4])],[w,scales]),opset_imports=[oh.make_opsetid('',17)])
    probe.ir_version=9;onnx.save(probe,args.out/'conv3d-probe.onnx')
