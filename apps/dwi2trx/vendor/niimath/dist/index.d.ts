import type { Operators, ImageProcessorMethods, DataType } from './types';
export type { Operators, OperatorDefinition, ImageProcessorMethods, MeshOptions, BitmapOptions, DataType } from './types';
export declare const dataTypes: {
    readonly char: "char";
    readonly short: "short";
    readonly int: "int";
    readonly float: "float";
    readonly double: "double";
    readonly input: "input";
};
export declare class Niimath {
    private worker;
    readonly operators: Operators;
    private outputDataType;
    readonly dataTypes: {
        readonly char: "char";
        readonly short: "short";
        readonly int: "int";
        readonly float: "float";
        readonly double: "double";
        readonly input: "input";
    };
    constructor();
    init(): Promise<boolean>;
    setOutputDataType(type: DataType): void;
    image(file: File): ImageProcessor;
}
interface ImageProcessorConfig {
    worker: Worker | null;
    file: File;
    operators: Operators;
    outputDataType?: DataType;
}
declare class ImageProcessor {
    private worker;
    private file;
    private operators;
    private commands;
    private outputDataType;
    [key: string]: unknown;
    constructor({ worker, file, operators, outputDataType }: ImageProcessorConfig);
    private _addCommand;
    private _generateMethods;
    run(outName?: string): Promise<Blob>;
}
interface ImageProcessor extends ImageProcessorMethods {
}
//# sourceMappingURL=index.d.ts.map
