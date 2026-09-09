#include "itkantsReadWriteTransform.h"
#include "itkResampleImageFilter.h"
#include "itkNearestNeighborInterpolateImageFunction.h"
#include "itkLinearInterpolateImageFunction.h"
#include <stdexcept>

// Arguments: --apply fixed moving output linear|nearest fill [transforms...]
// Transform order follows antsApplyTransforms CLI (last listed acts last in
// the physical pull mapping). Reverse CLI order into ITK's transform queue.
int applyTransforms(int argc, char* argv[]) {
  if(argc<8)throw std::runtime_error("--apply needs fixed, moving, output, interpolation, fill and transforms");
  using Image = itk::Image<float,3>;
  auto fixedReader=itk::ImageFileReader<Image>::New(); fixedReader->SetFileName(argv[2]); fixedReader->Update();
  auto movingReader=itk::ImageFileReader<Image>::New(); movingReader->SetFileName(argv[3]); movingReader->Update();
  auto composite=itk::CompositeTransform<double,3>::New();
  for(int i=argc-1;i>=7;--i) {
    std::string path(argv[i]); bool inverse=path.rfind("inverse:",0)==0;
    if(inverse)path=path.substr(8);
    auto transform=itk::ants::ReadTransform<double,3>(path);
    if(!transform)throw std::runtime_error("Cannot read transform: "+path);
    if(inverse)transform=transform->GetInverseTransform();
    if(!transform)throw std::runtime_error("Transform has no inverse: "+path);
    composite->AddTransform(transform);
  }
  auto resample=itk::ResampleImageFilter<Image,Image>::New();
  resample->SetInput(movingReader->GetOutput());resample->SetReferenceImage(fixedReader->GetOutput());
  resample->UseReferenceImageOn();resample->SetTransform(composite);
  const std::string interpolation(argv[5]);
  if(interpolation=="nearest")resample->SetInterpolator(itk::NearestNeighborInterpolateImageFunction<Image,double>::New());
  else if(interpolation=="linear")resample->SetInterpolator(itk::LinearInterpolateImageFunction<Image,double>::New());
  else throw std::runtime_error("Unknown interpolation mode");
  resample->SetDefaultPixelValue(std::stof(argv[6]));
  auto writer=itk::ImageFileWriter<Image>::New();writer->SetFileName(argv[4]);writer->SetInput(resample->GetOutput());writer->Update();
  return 0;
}
