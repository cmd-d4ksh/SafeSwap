package com.exsub.service;

import com.exsub.engine.SubstitutionRequest;
import com.exsub.engine.SubstitutionResult;
import com.exsub.model.InjuryRule;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Thin Spring facade over the pure-Java {@link com.exsub.engine.SubstitutionEngine}. */
@Service
public class SubstitutionService {

    public record InjuryInfo(String tag, String name, String area, String hint, String description, String guidance,
                             int contraindicatedExercises, List<InjuryRule.Contraindication> contraindications) { }

    private final CatalogService catalogService;

    public SubstitutionService(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    public SubstitutionResult substitute(SubstitutionRequest req) {
        return catalogService.snapshot().engine().substitute(req);
    }

    public List<InjuryInfo> injuries() {
        CatalogService.Snapshot s = catalogService.snapshot();
        Map<String, Integer> counts = s.contraindications().pairsPerInjury();
        List<InjuryInfo> out = new ArrayList<>();
        for (InjuryRule r : s.rules().rules()) {
            out.add(new InjuryInfo(r.tag(), r.name(), r.area(), r.hint(), r.description(), r.guidance(),
                    counts.getOrDefault(r.tag(), 0), r.contraindications()));
        }
        return out;
    }
}
